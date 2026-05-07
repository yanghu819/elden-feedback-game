const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_TOKEN = /\b(?:ghp|github_pat|gho|sk|pk)_[A-Za-z0-9_]{12,}\b/g;
const CREDIT_CARD_LIKE = /\b(?:\d[ -]*?){13,19}\b/g;

export function redactText(input: string) {
  return input
    .replace(EMAIL, "[redacted_email]")
    .replace(LONG_TOKEN, "[redacted_token]")
    .replace(CREDIT_CARD_LIKE, "[redacted_number]")
    .slice(0, 1000);
}

export function cleanLabel(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9:_-]/g, "-").slice(0, 50);
}
