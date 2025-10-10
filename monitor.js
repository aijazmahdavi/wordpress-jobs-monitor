const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;

const JOBS_URL = 'https://jobs.wordpress.net/';
const STORAGE_FILE = './seen-jobs.json';

// Email configuration from environment variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function loadSeenJobs() {
  try {
    const data = await fs.readFile(STORAGE_FILE, 'utf8');
    return new Set(JSON.parse(data));
  } catch (err) {
    return new Set();
  }
}

async function saveSeenJobs(seenJobs) {
  await fs.writeFile(STORAGE_FILE, JSON.stringify([...seenJobs], null, 2), 'utf8');
}

async function fetchJobs() {
  try {
    const response = await axios.get(JOBS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = response.data;
    const $ = cheerio.load(html);
    
    const jobs = [];
    
    // The site uses div.row for each job listing
    $('.row').each((i, elem) => {
      const $row = $(elem);
      
      // Skip header rows and rows without job-title
      if ($row.hasClass('row-head') || $row.hasClass('job-list-col-labels')) {
        return;
      }
      
      // Find the job title link
      const $titleDiv = $row.find('.job-title');
      const $link = $titleDiv.find('a');
      
      if (!$link.length) return;
      
      const title = $link.text().trim();
      const link = $link.attr('href');
      
      if (!title || !link) return;
      
      // Extract date, job type, and location
      const datePosted = $row.find('.job-date').text().trim();
      const jobType = $row.find('.job-type').text().trim();
      const location = $row.find('.job-location').text().trim();
      
      const fullLink = link.startsWith('http') ? link : `https://jobs.wordpress.net${link}`;
      
      jobs.push({
        id: fullLink,
        title,
        link: fullLink,
        jobType: jobType || 'Not specified',
        location: location || 'N/A',
        datePosted: datePosted || 'N/A'
      });
      
      console.log(`  Found: ${title} (${jobType}) - ${location} [${datePosted}]`);
    });
    
    return jobs;
  } catch (err) {
    console.error('Error fetching jobs:', err.message);
    return [];
  }
}

async function sendEmailNotification(newJobs) {
  const jobsList = newJobs.map(job => `
    <div style="margin-bottom: 20px; padding: 15px; border-left: 4px solid #0073aa; background: #f9f9f9;">
      <h3 style="margin: 0 0 10px 0; color: #0073aa;">${job.title}</h3>
      <p style="margin: 5px 0; color: #555;"><strong>Type:</strong> ${job.jobType}</p>
      <p style="margin: 5px 0; color: #555;"><strong>Location:</strong> ${job.location}</p>
      ${job.datePosted !== 'N/A' ? `<p style="margin: 5px 0; color: #888;"><strong>Posted:</strong> ${job.datePosted}</p>` : ''}
      <p style="margin: 10px 0 0 0;">
        <a href="${job.link}" 
           style="display: inline-block; padding: 8px 16px; background: #0073aa; 
                  color: white; text-decoration: none; border-radius: 4px;">
          View Job Details →
        </a>
      </p>
    </div>
  `).join('');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_TO,
    subject: `🚀 ${newJobs.length} New WordPress Job${newJobs.length > 1 ? 's' : ''} Available!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0073aa; border-bottom: 2px solid #0073aa; padding-bottom: 10px;">
          New WordPress Jobs Posted
        </h2>
        <p style="font-size: 16px; color: #333;">
          Found <strong>${newJobs.length}</strong> new job posting${newJobs.length > 1 ? 's' : ''} 
          on WordPress Jobs board:
        </p>
        ${jobsList}
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          Automated notification from WordPress Jobs Monitor<br>
          Checked at ${new Date().toLocaleString()}
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Email sent for ${newJobs.length} new job(s)`);
  } catch (err) {
    console.error('Error sending email:', err.message);
    throw err;
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for new jobs...`);
  
  // Validate environment variables
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.EMAIL_TO) {
    console.error('❌ Missing required environment variables!');
    console.error('Please set: EMAIL_USER, EMAIL_PASS, EMAIL_TO');
    process.exit(1);
  }
  
  console.log(`Email configured: ${process.env.EMAIL_USER} -> ${process.env.EMAIL_TO}`);
  
  const seenJobs = await loadSeenJobs();
  console.log(`Loaded ${seenJobs.size} previously seen jobs`);
  
  console.log('\nFetching jobs from WordPress Jobs...');
  const currentJobs = await fetchJobs();
  
  if (currentJobs.length === 0) {
    console.log('⚠ No jobs found - site structure may have changed');
    console.log('This might be normal if there are no jobs posted currently.');
    return;
  }
  
  console.log(`\nFound ${currentJobs.length} total jobs on the site`);
  
  const newJobs = currentJobs.filter(job => !seenJobs.has(job.id));
  
  if (newJobs.length > 0) {
    console.log(`\n🎉 Found ${newJobs.length} new job(s)!`);
    
    try {
      await sendEmailNotification(newJobs);
    } catch (emailErr) {
      console.error('Failed to send email:', emailErr.message);
    }
    
    newJobs.forEach(job => seenJobs.add(job.id));
    await saveSeenJobs(seenJobs);
    console.log('✓ Updated seen jobs list');
  } else {
    console.log('\n✓ No new jobs found');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  console.error('Stack trace:', err.stack);
  process.exit(1);
});
