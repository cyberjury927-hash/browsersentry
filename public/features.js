export const FEATURES = [
  { id: 'overview', label: 'Overview' },
  { id: 'threatactivity', label: 'Threat activity' },
  { id: 'siteprotect', label: 'Site protection' },
  { id: 'searchprotect', label: 'Search protection' },
  { id: 'downloads', label: 'Download scanning' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'darkweb', label: 'Identity & dark web' },
  { id: 'privacy', label: 'Privacy & ads' },
  { id: 'cookieblocker', label: 'Cookies' },
  { id: 'account', label: 'Account' },
  { id: 'settings', label: 'Settings' },
  { id: 'popup', label: 'Popup' },
  { id: 'auth', label: 'Authentication' },
  { id: 'background', label: 'Background / security' },
  { id: 'other', label: 'Other' }
];

const FEATURE_LABELS = Object.fromEntries(FEATURES.map(item => [item.id, item.label]));

export function getFeatureLabel(featureId) {
  return FEATURE_LABELS[featureId] || featureId || 'Other';
}

export function resolveFeature(event = {}) {
  if (event.feature) return event.feature;

  if (event.eventType === 'navigation' && event.label) return event.label;
  if (event.page === 'dashboard' && event.path) return event.path;

  const pageMap = {
    popup: 'popup',
    auth: 'auth',
    background: 'background',
    'analytics-dashboard': 'settings'
  };
  if (pageMap[event.page]) return pageMap[event.page];

  if (event.eventType === 'security') {
    const source = event.metadata?.source || event.detail || '';
    if (/download/i.test(source)) return 'downloads';
    if (/site|block|phish|malware/i.test(source)) return 'siteprotect';
    if (/extension/i.test(source)) return 'extensions';
    if (/search/i.test(source)) return 'searchprotect';
    if (/breach|leak|dark/i.test(source)) return 'darkweb';
    return 'background';
  }

  return event.page || 'other';
}

export function filterEventsByFeature(events, featureId) {
  if (!featureId || featureId === 'all') return events;
  return events.filter(event => resolveFeature(event) === featureId);
}
