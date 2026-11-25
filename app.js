const JORHAT_CENTER = [26.7509, 94.2037];
const SUPABASE_URL = 'https://qvnzxljlylccvuslzncj.supabase.co';
const STORAGE_KEY = 'jorhat_parklive_sb_key';

const INITIAL_SPOTS = [
  { id: 'gar-ali-1', name: 'Gar-Ali Central Commercial Stretch', zone: 'Gar-Ali', lat: 26.7524, lng: 94.2051, freeSpots: 9, totalSpots: 20, vehicleTypes: ['2w', '4w'], isPaid: false, trustScore: 88, updatedAt: new Date().toISOString() },
  { id: 'at-road-1', name: 'A.T. Road Baruah Chariali Bay', zone: 'A.T. Road', lat: 26.7568, lng: 94.2195, freeSpots: 4, totalSpots: 18, vehicleTypes: ['2w', '4w'], isPaid: false, trustScore: 84, updatedAt: new Date().toISOString() },
  { id: 'kb-road-1', name: 'K.B. Road Market Pocket', zone: 'K.B. Road', lat: 26.7489, lng: 94.2098, freeSpots: 0, totalSpots: 14, vehicleTypes: ['2w'], isPaid: true, trustScore: 91, updatedAt: new Date().toISOString() },
  { id: 'chowk-bazar-1', name: 'Chowk Bazar Outer Lane', zone: 'Chowk Bazar', lat: 26.7541, lng: 94.2016, freeSpots: 6, totalSpots: 15, vehicleTypes: ['2w', '4w'], isPaid: false, trustScore: 79, updatedAt: new Date().toISOString() },
  { id: 'court-field-1', name: 'Court Field & Rajmao Pukhuri Road', zone: 'Court Field', lat: 26.7462, lng: 94.2154, freeSpots: 16, totalSpots: 30, vehicleTypes: ['2w', '4w'], isPaid: false, trustScore: 93, updatedAt: new Date().toISOString() },
  { id: 'jmch-1', name: 'JMCH Visitor & Kenduguri Parking', zone: 'JMCH / Kenduguri', lat: 26.7275, lng: 94.1958, freeSpots: 5, totalSpots: 25, vehicleTypes: ['2w', '4w'], isPaid: true, trustScore: 86, updatedAt: new Date().toISOString() },
  { id: 'tarajan-1', name: 'Tarajan Commercial Strip', zone: 'Tarajan', lat: 26.7625, lng: 94.2260, freeSpots: 11, totalSpots: 16, vehicleTypes: ['2w'], isPaid: false, trustScore: 82, updatedAt: new Date().toISOString() },
  { id: 'jec-road-1', name: 'JEC Road & Garmur Approach', zone: 'JEC Road', lat: 26.7365, lng: 94.1845, freeSpots: 14, totalSpots: 22, vehicleTypes: ['2w', '4w'], isPaid: false, trustScore: 90, updatedAt: new Date().toISOString() }
];

let spots = [...INITIAL_SPOTS];
let activeFilter = 'all';
let searchQuery = '';
let selectedSpotId = null;
let userCoords = null;
let sbClient = null;
let liveChannel = null;
let map = null;
let markersLayer = null;
let userMarker = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function getStatusColor(spot) {
  if (spot.freeSpots <= 0) return 'red';
  const ratio = spot.freeSpots / Math.max(1, spot.totalSpots);
  return ratio <= 0.25 ? 'amber' : 'green';
}

function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function normalizeRow(row) {
  return {
    id: row.id,
    name: row.name,
    zone: row.zone,
    lat: Number(row.lat),
    lng: Number(row.lng),
    freeSpots: Number(row.free_spots),
    totalSpots: Number(row.total_spots),
    vehicleTypes: Array.isArray(row.vehicle_types) ? row.vehicle_types : ['2w'],
    isPaid: Boolean(row.is_paid),
    trustScore: Number(row.trust_score ?? 80),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function setDbStatus(isLive, labelText) {
  const dot = document.getElementById('dbDot');
  const label = document.getElementById('dbStatusText');
  dot.classList.toggle('live', isLive);
  label.textContent = labelText;
}

async function connectSupabase(key) {
  const cleanKey = (key || '').trim();
  if (!cleanKey || !window.supabase) {
    sbClient = null;
    setDbStatus(false, 'Local Demo');
    return;
  }

  try {
    sbClient = window.supabase.createClient(SUPABASE_URL, cleanKey);
    const { data, error } = await sbClient
      .from('parking_spots')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    if (Array.isArray(data) && data.length > 0) {
      spots = data.map(normalizeRow);
    }

    if (liveChannel) {
      await sbClient.removeChannel(liveChannel);
    }

    liveChannel = sbClient
      .channel('jorhat-parklive-spots')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parking_spots' },
        (payload) => {
          if (payload.eventType === 'DELETE' && payload.old) {
            spots = spots.filter((s) => s.id !== payload.old.id);
          } else if (payload.new) {
            const incoming = normalizeRow(payload.new);
            const idx = spots.findIndex((s) => s.id === incoming.id);
            if (idx >= 0) spots[idx] = incoming;
            else spots.push(incoming);
          }
          renderAll();
        }
      )
      .subscribe();

    localStorage.setItem(STORAGE_KEY, cleanKey);
    setDbStatus(true, 'Live Supabase');
    showToast('Connected to Supabase Realtime');
    renderAll();
  } catch (err) {
    sbClient = null;
    setDbStatus(false, 'Local Demo');
    showToast('Supabase check failed; using local mode');
    console.error(err);
  }
}

function getFilteredSpots() {
  const q = searchQuery.trim().toLowerCase();
  return spots
    .map((s) => ({
      ...s,
      distKm: userCoords ? distanceKm(userCoords, { lat: s.lat, lng: s.lng }) : null
    }))
    .filter((s) => {
      if (activeFilter === 'free' && s.isPaid) return false;
      if (activeFilter === '2w' && !s.vehicleTypes.includes('2w')) return false;
      if (activeFilter === '4w' && !s.vehicleTypes.includes('4w')) return false;
      if (activeFilter === 'near' && userCoords && s.distKm > 3) return false;
      if (q) {
        const hay = `${s.name} ${s.zone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.distKm != null && b.distKm != null) return a.distKm - b.distKm;
      return b.freeSpots - a.freeSpots;
    });
}

function renderMapMarkers(list) {
  markersLayer.clearLayers();
  list.forEach((spot) => {
    const color = getStatusColor(spot);
    const icon = L.divIcon({
      className: '',
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      html: `<div class="spot-marker ${color}"><span>${spot.freeSpots}</span></div>`
    });

    const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(markersLayer);
    marker.on('click', () => {
      selectedSpotId = spot.id;
      map.setView([spot.lat, spot.lng], Math.max(map.getZoom(), 15), { animate: true });
      renderList();
    });
  });
}

async function mutateFreeSpots(spotId, delta) {
  const target = spots.find((s) => s.id === spotId);
  if (!target) return;
  const nextFree = Math.max(0, Math.min(target.totalSpots, target.freeSpots + delta));
  const nextUpdated = new Date().toISOString();

  target.freeSpots = nextFree;
  target.updatedAt = nextUpdated;
  renderAll();

  if (sbClient) {
    const { error } = await sbClient
      .from('parking_spots')
      .update({ free_spots: nextFree, updated_at: nextUpdated })
      .eq('id', spotId);
    if (error) showToast('Sync error: ' + error.message);
  }
}

async function verifySpot(spotId) {
  const target = spots.find((s) => s.id === spotId);
  if (!target) return;
  const nextTrust = Math.min(100, (target.trustScore || 80) + 2);
  const nextUpdated = new Date().toISOString();

  target.trustScore = nextTrust;
  target.updatedAt = nextUpdated;
  renderAll();
  showToast('Spot verified (+2% trust)');

  if (sbClient) {
    const { error } = await sbClient
      .from('parking_spots')
      .update({ trust_score: nextTrust, updated_at: nextUpdated })
      .eq('id', spotId);
    if (error) console.error(error);
  }
}

function renderList() {
  const listEl = document.getElementById('spotList');
  const countEl = document.getElementById('listCount');
  const filtered = getFilteredSpots();
  countEl.textContent = `${filtered.length} zones`;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="spot-meta">No parking spots match this filter.</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((spot) => {
      const color = getStatusColor(spot);
      const veh = spot.vehicleTypes.map((v) => v.toUpperCase()).join(' + ');
      const cost = spot.isPaid ? 'Paid' : 'Free';
      const distText = spot.distKm != null ? ` • ${spot.distKm.toFixed(1)} km` : '';
      const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`;
      const isSelected = spot.id === selectedSpotId;

      return `
        <div class="spot-card" style="${isSelected ? 'border-color:#0f766e;background:#f0fdfa;' : ''}" onclick="focusSpot('${spot.id}')">
          <div class="spot-top">
            <div>
              <div class="spot-name">${spot.name}</div>
              <div class="spot-meta">${spot.zone} • ${veh} • ${cost} • Trust ${spot.trustScore}%${distText}</div>
            </div>
            <span class="count-badge ${color}">${spot.freeSpots}/${spot.totalSpots} free</span>
          </div>
          <div class="action-row" onclick="event.stopPropagation()">
            <button class="btn btn-secondary" onclick="mutateFreeSpots('${spot.id}', -1)">Parked (-1)</button>
            <button class="btn btn-success" onclick="mutateFreeSpots('${spot.id}', 1)">Vacate (+1)</button>
            <button class="btn btn-warn" onclick="verifySpot('${spot.id}')">Verify</button>
            <a class="nav-link" href="${navUrl}" target="_blank" rel="noopener">Navigate</a>
          </div>
        </div>
      `;
    })
    .join('');
}

function focusSpot(id) {
  const spot = spots.find((s) => s.id === id);
  if (!spot) return;
  selectedSpotId = id;
  map.setView([spot.lat, spot.lng], 15, { animate: true });
  renderList();
}

function renderAll() {
  const filtered = getFilteredSpots();
  renderMapMarkers(filtered);
  renderList();
}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView(JORHAT_CENTER, 14);

  const primaryTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    crossOrigin: 'anonymous',
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  });

  const fallbackTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });

  let switched = false;
  primaryTiles.on('tileerror', () => {
    if (!switched) {
      switched = true;
      map.removeLayer(primaryTiles);
      fallbackTiles.addTo(map);
    }
  });

  primaryTiles.addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast('GPS not supported on this device');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userCoords.lat, userCoords.lng], 15, { animate: true });
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#2563eb',
        fillOpacity: 1
      }).addTo(map);
      showToast('Centered on your GPS location');
      renderAll();
    },
    () => showToast('Location permission denied; showing Jorhat'),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function openInsertModal() {
  const center = map ? map.getCenter() : { lat: JORHAT_CENTER[0], lng: JORHAT_CENTER[1] };
  document.getElementById('spotLat').value = center.lat.toFixed(4);
  document.getElementById('spotLng').value = center.lng.toFixed(4);
  document.getElementById('insertModal').classList.add('open');
}

function closeInsertModal() {
  document.getElementById('insertModal').classList.remove('open');
}

function openDbModal() {
  document.getElementById('sbKeyInput').value = localStorage.getItem(STORAGE_KEY) || '';
  document.getElementById('dbModal').classList.add('open');
}

function closeDbModal() {
  document.getElementById('dbModal').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderAll();

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderAll();
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      if (activeFilter === 'near' && !userCoords) locateUser();
      renderAll();
    });
  });

  document.getElementById('gpsBtn').addEventListener('click', locateUser);
  document.getElementById('recenterBtn').addEventListener('click', () => {
    map.setView(JORHAT_CENTER, 14, { animate: true });
  });

  document.getElementById('openInsertTopBtn').addEventListener('click', openInsertModal);
  document.getElementById('openInsertFabBtn').addEventListener('click', openInsertModal);
  document.getElementById('cancelInsertBtn').addEventListener('click', closeInsertModal);

  document.getElementById('insertForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('spotName').value.trim();
    const zone = document.getElementById('spotZone').value;
    const lat = Number(document.getElementById('spotLat').value);
    const lng = Number(document.getElementById('spotLng').value);
    const freeSpots = Math.max(0, Number(document.getElementById('spotFree').value));
    const totalSpots = Math.max(1, Number(document.getElementById('spotTotal').value));
    const isPaid = document.getElementById('spotPaid').value === 'true';

    const vehicleTypes = [];
    if (document.getElementById('veh2w').checked) vehicleTypes.push('2w');
    if (document.getElementById('veh4w').checked) vehicleTypes.push('4w');
    if (vehicleTypes.length === 0) vehicleTypes.push('2w');

    const newSpot = {
      id: `spot-${Date.now()}`,
      name,
      zone,
      lat,
      lng,
      freeSpots,
      totalSpots,
      vehicleTypes,
      isPaid,
      trustScore: 80,
      updatedAt: new Date().toISOString()
    };

    spots.unshift(newSpot);
    selectedSpotId = newSpot.id;
    closeInsertModal();
    e.target.reset();
    map.setView([lat, lng], 15, { animate: true });
    renderAll();
    showToast('Parking spot added');

    if (sbClient) {
      const { error } = await sbClient.from('parking_spots').insert({
        id: newSpot.id,
        name: newSpot.name,
        zone: newSpot.zone,
        lat: newSpot.lat,
        lng: newSpot.lng,
        free_spots: newSpot.freeSpots,
        total_spots: newSpot.totalSpots,
        vehicle_types: newSpot.vehicleTypes,
        is_paid: newSpot.isPaid,
        trust_score: newSpot.trustScore,
        updated_at: newSpot.updatedAt
      });
      if (error) showToast('DB insert error: ' + error.message);
    }
  });

  document.getElementById('dbStatusBtn').addEventListener('click', openDbModal);
  document.getElementById('cancelDbBtn').addEventListener('click', closeDbModal);
  document.getElementById('saveDbKeyBtn').addEventListener('click', async () => {
    const val = document.getElementById('sbKeyInput').value;
    closeDbModal();
    await connectSupabase(val);
  });

  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) connectSupabase(savedKey);
});
