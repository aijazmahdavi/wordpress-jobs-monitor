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
    
    // Try multiple selectors for job listings
    const jobElements = $('li.job_listing, article.job_listing, .job-listing, tr.job_listing');
    
    console.log(`Found ${jobElements.length} job elements`);
    
    jobElements.each((i, elem) => {
      const $job = $(elem);
      
      // Try to find the title and link
      let title = '';
      let link = '';
      
      // Try different selectors for title/link
      const $titleLink = $job.find('.job_listing-clickbox, a.job_listing-clickbox, h3 a, .position a, a[href*="/job/"]').first();
      
      if ($titleLink.length) {
        title = $titleLink.text().trim();
        link = $titleLink.attr('href');
      }
      
      // Fallback: try to find any link with job in URL
      if (!link) {
        const $anyLink = $job.find('a[href*="/job/"]').first();
        if ($anyLink.length) {
          link = $anyLink.attr('href');
          title = $anyLink.text().trim() || $job.find('.position, .job-title, h3').first().text().trim();
        }
      }
      
      const company = $job.find('.company, .meta .company, td.company').first().text().trim();
      const location = $job.find('.location, .meta .location, td.location').first().text().trim();
      const datePosted = $job.find('.date, time, .job-posted').first().text().trim();
      
      if (title && link) {
        const fullLink = link.startsWith('http') ? link : `https://jobs.wordpress.net${link}`;
        jobs.push({
          id: fullLink,
          title,
          link: fullLink,
          company: company || 'Not specified',
          location: location || 'Remote/Not specified',
          datePosted: datePosted || 'N/A'
        });
        
        console.log(`  ${i+1}. ${title} - ${company}`);
      }
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
      <p style="margin: 5px 0; color: #555;"><strong>Company:</strong> ${job.company}</p>
      <p style="margin: 5px 0; color: #555;"><strong>Location:</strong> ${job.location}</p>
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
  
  const currentJobs = await fetchJobs();
  
  if (currentJobs.length === 0) {
    console.log('⚠ No jobs found - site structure may have changed');
    console.log('This might be normal if there are no jobs posted currently.');
    return;
  }
  
  console.log(`Found ${currentJobs.length} total jobs on the site`);
  
  const newJobs = currentJobs.filter(job => !seenJobs.has(job.id));
  
  if (newJobs.length > 0) {
    console.log(`🎉 Found ${newJobs.length} new job(s)!`);
    newJobs.forEach(job => console.log(`  - ${job.title} at ${job.company}`));
    
    try {
      await sendEmailNotification(newJobs);
    } catch (emailErr) {
      console.error('Failed to send email, but continuing...');
    }
    
    newJobs.forEach(job => seenJobs.add(job.id));
    await saveSeenJobs(seenJobs);
    console.log('✓ Updated seen jobs list');
  } else {
    console.log('✓ No new jobs found');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  console.error('Stack trace:', err.stack);
  process.exit(1);
});
