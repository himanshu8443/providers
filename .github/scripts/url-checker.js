const fs = require('fs');
const axios = require('axios');

const FILE_PATH = 'modflix.json';
const updatedProviders = []; // Track updated providers for Discord notification

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

// Extract domain (origin) from URL without trailing slash
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin;
  } catch (error) {
    console.error(`Error parsing URL ${url}:`, error);
    return url;
  }
}

// Check if original URL has a trailing slash in path
function hasTrailingSlash(url) {
  return url.endsWith('/') && !url.endsWith('://');
}

// Check URL and return new URL if domain redirected
async function checkUrl(url) {
  try {
    // Set timeout to 10 seconds to avoid hanging
    const response = await axios.head(url, {
      maxRedirects: 0,
      timeout: 10000,
      validateStatus: status => true
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
        
        // Get the new domain
        const newDomain = getDomain(fullRedirectUrl);
        
        // Check if original URL had a trailing slash
        const needsTrailingSlash = hasTrailingSlash(url);
        
        // Create new URL: new domain + trailing slash if the original had one
        let finalUrl = newDomain;
        if (needsTrailingSlash) {
          finalUrl += '/';
        }
        
        console.log(`Will update to: ${finalUrl} (preserved trailing slash: ${needsTrailingSlash})`);
        return finalUrl;
      }
    } else {
      console.log(`⚠️ ${url} returned status ${response.status}`);
    }
  } catch (error) {
    // Try GET request if HEAD fails
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
          
          let fullRedirectUrl = newLocation;
          if (!newLocation.startsWith('http')) {
            const baseUrl = new URL(url);
            fullRedirectUrl = new URL(newLocation, baseUrl.origin).toString();
          }
          
          // Get the new domain
          const newDomain = getDomain(fullRedirectUrl);
          
          // Check if original URL had a trailing slash
          const needsTrailingSlash = hasTrailingSlash(url);
          
          // Create new URL: new domain + trailing slash if the original had one
          let finalUrl = newDomain;
          if (needsTrailingSlash) {
            finalUrl += '/';
          }
          
          console.log(`Will update to: ${finalUrl} (preserved trailing slash: ${needsTrailingSlash})`);
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
        // Store the old URL before updating
        const oldUrl = provider.url;
        
        // Update the provider URL
        provider.url = newUrl;
        hasChanges = true;
        console.log(`Updated ${provider.name} URL from ${oldUrl} to ${newUrl}`);
        
        // Track updated provider for Discord notification
        updatedProviders.push({
          name: provider.name,
          oldUrl: oldUrl,
          newUrl: newUrl
        });
      }
    } catch (error) {
      console.log(`❌ Error processing ${url}: ${error.message}`);
    }
  }
  
  // Write changes back to file if needed
  if (hasChanges) {
    // Use a space-efficient JSON format but with proper formatting
    const jsonString = JSON.stringify(providers, null, 2);
    fs.writeFileSync(FILE_PATH, jsonString);
    console.log(`✅ Updated ${FILE_PATH} with new URLs`);
    
    // Output updated providers for Discord notification in a clean format
    if (updatedProviders.length > 0) {
      console.log("\n### UPDATED_PROVIDERS_START ###");
      for (const provider of updatedProviders) {
        // Format: name|oldUrl|newUrl (pipe-delimited for easy parsing)
        console.log(`${provider.name}|${provider.oldUrl}|${provider.newUrl}`);
      }
      console.log("### UPDATED_PROVIDERS_END ###");
    }
  } else {
    console.log(`ℹ️ No changes needed for ${FILE_PATH}`);
  }
}

// Execute main function with error handling
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
