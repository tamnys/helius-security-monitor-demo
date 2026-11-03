export function credentialedUrl(value, apiKey) {
  const url = new URL(value);
  if (apiKey) url.searchParams.set('api-key', apiKey);
  return url.toString();
}

export function publicUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}
