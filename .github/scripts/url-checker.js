const fs = require('fs');
const axios = require('axios');

const FILE_PATH = 'modflix.json';
const updatedProviders = []; // Track updated providers for Discord notification

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

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

function getFinalUrl(response, originalUrl) {
  return (
    response?.request?.res?.responseUrl ||
    response?.request?._redirectable?._currentUrl ||
    response?.config?.url ||
    originalUrl
  );
}

function normalizeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function requestUrl(method, url) {
  return axios({
    method,
    url,
    maxRedirects: 5,
    timeout: 10000,
    validateStatus: status => true,
    headers: DEFAULT_HEADERS
  });
}

function logVerboseResult(url, response, finalUrl) {
  const status = response?.status ?? 'unknown';
  const locationHeader = response?.headers?.location;
  console.log(
    `ℹ️ ${url} -> status=${status} final=${finalUrl}` +
      (locationHeader ? ` location=${locationHeader}` : '')
  );
}

function shouldUpdateFromFinalUrl(originalUrl, finalUrl) {
  const originalDomain = getDomain(originalUrl);
  const finalDomain = getDomain(finalUrl);
  return finalDomain && finalDomain !== originalDomain;
}

// Check URL and return new URL if domain redirected or resolved elsewhere
async function checkUrl(url) {
  try {
    const response = await requestUrl('get', url);
    const finalUrl = getFinalUrl(response, url);
    logVerboseResult(url, response, finalUrl);

    if (shouldUpdateFromFinalUrl(url, finalUrl)) {
      const updatedUrl = normalizeOrigin(finalUrl) + (hasTrailingSlash(url) ? '/' : '');
      console.log(`🔄 ${url} resolved to ${finalUrl}`);
      console.log(`Will update to: ${updatedUrl} (preserved trailing slash: ${hasTrailingSlash(url)})`);
      return updatedUrl;
    }

    if (response.status === 200) {
      console.log(`✅ ${url} is valid (200 OK)`);
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const newLocation = response.headers.location;
      if (newLocation) {
        let fullRedirectUrl = newLocation;
        if (!newLocation.startsWith('http')) {
          const baseUrl = new URL(url);
          fullRedirectUrl = new URL(newLocation, baseUrl.origin).toString();
        }

        if (shouldUpdateFromFinalUrl(url, fullRedirectUrl)) {
          const newDomain = normalizeOrigin(fullRedirectUrl);
          const needsTrailingSlash = hasTrailingSlash(url);
          const finalUrlForUpdate = newDomain + (needsTrailingSlash ? '/' : '');
          console.log(`🔄 ${url} redirects to ${fullRedirectUrl}`);
          console.log(
            `Will update to: ${finalUrlForUpdate} (preserved trailing slash: ${needsTrailingSlash})`
          );
          return finalUrlForUpdate;
        }
      }
    }

    console.log(`⚠️ ${url} returned status ${response.status}`);
  } catch (error) {
    if (error.response) {
      const finalUrl = getFinalUrl(error.response, url);
      logVerboseResult(url, error.response, finalUrl);

      // If the request resolves to a different origin even with a non-2xx status,
      // use that as an update signal. This keeps existing behavior intact while
      // allowing sites that block HEAD/GET with 403 but still resolve elsewhere.
      if (shouldUpdateFromFinalUrl(url, finalUrl)) {
        const updatedUrl = normalizeOrigin(finalUrl) + (hasTrailingSlash(url) ? '/' : '');
        console.log(`🔄 ${url} resolved to ${finalUrl}`);
        console.log(
          `Will update to: ${updatedUrl} (preserved trailing slash: ${hasTrailingSlash(url)})`
        );
        return updatedUrl;
      }

      console.log(`⚠️ ${url} returned status ${error.response.status}`);
    } else if (error.code === 'ECONNABORTED') {
      console.log(`⌛ ${url} request timed out`);
    } else if (error.code === 'ENOTFOUND') {
      console.log(`❌ ${url} domain not found`);
    } else {
      console.log(`❌ Error checking ${url}: ${error.message}`);
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
