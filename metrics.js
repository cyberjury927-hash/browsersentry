import { FEATURES, resolveFeature } from './public/features.js';

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function emptyFeatureStats() {
  return {
    events: 0,
    views: 0,
    clicks: 0,
    navigation: 0,
    security: 0,
    auth: 0,
    devices: new Set(),
    users: new Set(),
    topActions: new Map(),
    topElements: new Map()
  };
}

export function computeMetrics(events = []) {
  const installDevices = new Set();
  const updateDevices = new Set();
  const allDevices = new Set();
  const allUsers = new Set();
  const featureStats = Object.fromEntries(FEATURES.map(item => [item.id, emptyFeatureStats()]));

  for (const event of events) {
    if (event.deviceId) allDevices.add(event.deviceId);
    if (event.userId) allUsers.add(event.userId);
    if (event.userEmail) allUsers.add(event.userEmail);

    if (
      event.deviceId &&
      (event.eventType === 'install' || (event.eventType === 'lifecycle' && event.action === 'install'))
    ) {
      installDevices.add(event.deviceId);
    }
    if (event.eventType === 'lifecycle' && event.action === 'update' && event.deviceId) {
      updateDevices.add(event.deviceId);
    }

    const featureId = resolveFeature(event);
    const bucket = featureStats[featureId] || featureStats.other;
    bucket.events += 1;
    if (event.deviceId) bucket.devices.add(event.deviceId);
    if (event.userId || event.userEmail) bucket.users.add(event.userId || event.userEmail);

    if (event.eventType === 'page_view') bucket.views += 1;
    if (event.eventType === 'navigation') bucket.navigation += 1;
    if (event.eventType === 'click') {
      bucket.clicks += 1;
      const element = event.element || event.label || 'unknown';
      bucket.topElements.set(element, (bucket.topElements.get(element) || 0) + 1);
    }
    if (event.eventType === 'security') bucket.security += 1;
    if (event.eventType === 'auth') bucket.auth += 1;

    const actionKey = event.action || event.eventType || 'event';
    bucket.topActions.set(actionKey, (bucket.topActions.get(actionKey) || 0) + 1);
  }

  const features = {};
  for (const feature of FEATURES) {
    const stat = featureStats[feature.id];
    features[feature.id] = {
      id: feature.id,
      label: feature.label,
      events: stat.events,
      views: stat.views + stat.navigation,
      clicks: stat.clicks,
      security: stat.security,
      auth: stat.auth,
      uniqueDevices: stat.devices.size,
      uniqueUsers: stat.users.size,
      topActions: [...stat.topActions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, count]) => ({ label, count })),
      topElements: [...stat.topElements.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, count]) => ({ label, count }))
    };
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const activeDevices7d = uniqueCount(
    events.filter(event => now - Number(event.timestamp) <= 7 * dayMs).map(event => event.deviceId)
  );
  const activeDevices30d = uniqueCount(
    events.filter(event => now - Number(event.timestamp) <= 30 * dayMs).map(event => event.deviceId)
  );

  return {
    totalEvents: events.length,
    extensionInstalls: installDevices.size,
    extensionUpdates: updateDevices.size,
    activeDevices: allDevices.size,
    activeDevices7d,
    activeDevices30d,
    registeredUsers: allUsers.size,
    features: Object.values(features).sort((a, b) => b.events - a.events)
  };
}
