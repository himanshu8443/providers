const fs = require('fs');
const axios = require('axios');
const path = require('path');

const FILE_PATH = 'modflix.json';

// Read the modflix.json file
function readModflixJson() {
  try {
    const data = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${FILE_PATH}:`, error);
    process.exit(1);
  }
}

// Extract domain from URL
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin;
  } catch (error) {
    console.error(`Error parsing URL ${url}:`, error);
    return url;
  }
}

// Extract path from URL
function getPath(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname + urlObj.search + urlObj.hash;
  } catch (error) {
    console.error(`Error extracting path from ${url}:`, error);
    return '';
  }
}

// Check URL and return new URL if redirected
async function checkUrl(url) {
  try {
    // Set timeout to 10 seconds to avoid hanging
    const response = await axios.head(url, {
      maxRedirects: 0,
      timeout: 10000,
      validateStatus: status => true // Accept all status codes to handle them manually
    });
    
    // If status is 200, no change needed
    if (response.status === 200) {
      console.log(`✅ ${url} is valid (200 OK)`);
      return null;
    } else if (response.status >= 300 && response.status < 400) {
      // Handle redirects
      const newLocation = response.headers.location;
      if (newLocation) {
        // If it's a relative redirect, construct the full URL
        let fullRedirectUrl = newLocation;
        if (!newLocation.startsWith('http')) {
          const baseUrl = new URL(url);
          fullRedirectUrl = new URL(newLocation, baseUrl.origin).toString();
        }
        
        console.log(`🔄 ${url} redirects to ${fullRedirectUrl}`);
        
        // Get new domain but keep original path
        const newDomain = getDomain(fullRedirectUrl);
        const originalPath = getPath(url);
        
        // Construct new URL with original path
        let finalUrl = newDomain;
        if (originalPath && originalPath !== '/') {
          finalUrl += originalPath;
        }
        
        return finalUrl;
      }
    } else {
      console.log(`⚠️ ${url} returned status ${response.status}`);
    }
  } catch (error) {
    // Try GET request if HEAD fails (some servers don't properly support HEAD)
    try {
      const response = await axios.get(url, {
        maxRedirects: 0,
        timeout: 10000,
        validateStatus: status => true
      });
      
      if (response.status === 200) {
        console.log(`✅ ${url} is valid (200 OK)`);
        return null;
      } else if (response.status >= 300 && response.status < 400) {
        // Handle redirects
        const newLocation = response.headers.location;
        if (newLocation) {
          console.log(`🔄 ${url} redirects to ${newLocation}`);
          
          // Process redirect similar to above
          let fullRedirectUrl = newLocation;
          if (!newLocation.startsWith('http')) {
            const baseUrl = new URL(url);
            fullRedirectUrl = new URL(newLocation, baseUrl.origin).toString();
          }
          
          const newDomain = getDomain(fullRedirectUrl);
          const originalPath = getPath(url);
          
          let finalUrl = newDomain;
          if (originalPath && originalPath !== '/') {
            finalUrl += originalPath;
          }
          
          return finalUrl;
        }
      } else {
        console.log(`⚠️ ${url} returned status ${response.status}`);
      }
    } catch (getError) {
      if (getError.response) {
        console.log(`⚠️ ${url} returned status ${getError.response.status}`);
      } else if (getError.code === 'ECONNABORTED') {
        console.log(`⌛ ${url} request timed out`);
      } else if (getError.code === 'ENOTFOUND') {
        console.log(`❌ ${url} domain not found`);
      } else {
        console.log(`❌ Error checking ${url}: ${getError.message}`);
      }
    }
  }
  
  // Return null if no change or error
  return null;
}

// Main function
async function main() {
  const providers = readModflixJson();
  let hasChanges = false;
  
  // Process each provider
  for (const [key, provider] of Object.entries(providers)) {
    const url = provider.url;
    console.log(`Checking ${provider.name} (${url})...`);
    
    try {
      const newUrl = await checkUrl(url);
      if (newUrl && newUrl !== url) {
        provider.url = newUrl;
        hasChanges = true;
        console.log(`Updated ${provider.name} URL from ${url} to ${newUrl}`);
      }
    } catch (error) {
      console.log(`❌ Error processing ${url}: ${error.message}`);
    }
  }
  
  // Write changes back to file if needed
  if (hasChanges) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(providers, null, 2));
    console.log(`✅ Updated ${FILE_PATH} with new URLs`);
  } else {
    console.log(`ℹ️ No changes needed for ${FILE_PATH}`);
  }
}

// Execute main function with error handling
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
