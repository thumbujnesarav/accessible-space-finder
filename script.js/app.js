// =====================================================================
// app.js: connects everything.
//   1. loads the data (Supabase, or the backup in data.js)
//   2. builds the filter buttons
//   3. every time the user changes something: asks search.js for the list,
//      then draws the cards and the map pins
// =====================================================================

// ---------- The current state of the page (what the user has chosen) ----------
const state = {
  lang: "en",          // "en" or "kn"
  query: "",           // text in the search box
  category: "all",     // "all", "park", "library", "community", "toilet"
  features: [],        // ticked features, e.g. ["has_ramp", "has_seating"]
  sort: "name",        // "name", "accessible", "nearest"
  userPos: null,       // { lat, lng } after "Use my location"
  highContrast: false,
};

let DATA = { categories: [], places: [] };
let dataSource = "sample";

// Map things
let map = null;
const markers = {}; // place id -> Leaflet marker
const MANDYA_CENTER = [12.526, 76.895];

// ---------- Small helpers ----------

// t("countMany", {n: 5}) -> "5 places found" (in the current language)
function t(key, vars) {
  let s = (TEXT[state.lang] && TEXT[state.lang][key]) || TEXT.en[key] || key;
  if (vars) Object.keys(vars).forEach((k) => (s = s.replace("{" + k + "}", vars[k])));
  return s;
}

// Picks the English or Kannada version of a field, e.g. pick(place, "name")
function pick(obj, field) {
  return obj[field + "_" + state.lang] || obj[field + "_en"];
}

// Stops text from the database being treated as HTML (safety).
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------- 1. LOAD DATA ----------
// Tries Supabase first. If it is not set up or fails, uses data.js.
async function loadData() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const headers = { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY };
      // Supabase gives every table a ready-made web address (REST API).
      const [catRes, placeRes] = await Promise.all([
        fetch(SUPABASE_URL + "/rest/v1/categories?select=*", { headers }),
        fetch(SUPABASE_URL + "/rest/v1/places?select=*", { headers }),
      ]);
      if (!catRes.ok || !placeRes.ok) throw new Error("Supabase replied " + catRes.status + "/" + placeRes.status);
      const categories = await catRes.json();
      const places = await placeRes.json();
      if (!places.length) throw new Error("Supabase has no places yet");
      DATA = { categories, places };
      dataSource = "supabase";
      return;
    } catch (err) {
      console.warn("Could not load from Supabase, using sample data instead.", err);
    }
  }
  DATA = SAMPLE_DATA;
  dataSource = "sample";
}

// ---------- 2. BUILD THE FILTER CONTROLS ----------
function buildCategoryChips() {
  const box = document.getElementById("category-chips");
  const options = [{ id: "all", icon: "✨" }].concat(DATA.categories);
  box.innerHTML = options
    .map((c) => {
      const label = c.id === "all" ? t("all") : pick(c, "name");
      const pressed = state.category === c.id;
      return `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${pressed}">
                <span aria-hidden="true">${esc(c.icon)}</span> ${esc(label)}</button>`;
    })
    .join("");
  box.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.category = btn.dataset.cat;
      buildCategoryChips();
      render();
    })
  );
}

function buildFeatureBoxes() {
  const box = document.getElementById("feature-boxes");
  box.innerHTML = FEATURES.map((f) => {
    const checked = state.features.includes(f.key) ? "checked" : "";
    return `<label class="check"><input type="checkbox" value="${f.key}" ${checked} /> ${esc(t(f.key))}</label>`;
  }).join("");
  box.querySelectorAll("input").forEach((input) =>
    input.addEventListener("change", () => {
      state.features = [...box.querySelectorAll("input:checked")].map((i) => i.value);
      render();
    })
  );
}

// ---------- 3. DRAW THE RESULTS ----------
function featureList(p) {
  // One small tag per feature: ✓ green if present, ✗ grey if not.
  const items = [
    ["has_ramp", p.has_ramp],
    ["has_lighting", p.has_lighting],
    ["has_seating", p.has_seating],
    ["has_toilet", p.has_toilet],
  ];
  const wcText = { yes: t("wcYes"), limited: t("wcLimited"), no: t("wcNo") }[p.wheelchair] || t("wcNo");
  const wcClass = p.wheelchair === "yes" ? "yes" : p.wheelchair === "limited" ? "part" : "no";
  let html = `<li class="tag ${wcClass}"><span aria-hidden="true">${wcClass === "yes" ? "✓" : wcClass === "part" ? "◐" : "✗"}</span> ${esc(wcText)}</li>`;
  items.forEach(([key, has]) => {
    html += `<li class="tag ${has ? "yes" : "no"}"><span aria-hidden="true">${has ? "✓" : "✗"}</span>
             ${esc(t(key))}<span class="sr-only">: ${has ? t("yes") : t("no")}</span></li>`;
  });
  if (p.has_toilet) {
    html += `<li class="tag ${p.accessible_toilet ? "yes" : "part"}"><span aria-hidden="true">${p.accessible_toilet ? "♿" : "!"}</span>
             ${esc(p.accessible_toilet ? t("accToilet") : t("noAccToilet"))}</li>`;
  }
  return html;
}

function render() {
  const list = findPlaces(DATA.places, DATA.categories, state);
  const catById = {};
  DATA.categories.forEach((c) => (catById[c.id] = c));

  // Count line
  document.getElementById("count").textContent =
    list.length === 1 ? t("countOne") : t("countMany", { n: list.length });

  // Cards
  const ul = document.getElementById("results");
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${esc(t("none"))}</li>`;
  } else {
    ul.innerHTML = list
      .map((p) => {
        const c = catById[p.category] || {};
        const dist = p.distance != null ? `<span class="dist">${esc(t("km", { n: p.distance.toFixed(1) }))}</span>` : "";
        const osmDir = `https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lng}`;
        return `
        <li class="card" id="card-${esc(p.id)}" style="--cat:${esc(c.color)}">
          <div class="card-top">
            <span class="cat-icon" aria-hidden="true">${esc(c.icon)}</span>
            <div class="card-title">
              <h2>${esc(pick(p, "name"))}</h2>
              <p class="small">${esc(pick(c, "name"))} · ${esc(pick(p, "area"))} ${dist}</p>
            </div>
            <span class="score" title="${esc(t("score", { n: p.score }))}">${esc(t("score", { n: p.score }))}</span>
          </div>
          <ul class="tags">${featureList(p)}</ul>
          <p class="small"><strong>${esc(t("hours"))}:</strong> ${esc(pick(p, "hours"))}
             · <span class="src ${p.source}">${esc(p.source === "osm" ? t("srcOsm") : t("srcSample"))}</span></p>
          <div class="card-actions">
            <button type="button" class="btn btn-small" data-show="${esc(p.id)}">${esc(t("showMap"))}</button>
            <a class="btn btn-small btn-ghost" href="${osmDir}" target="_blank" rel="noopener">${esc(t("directions"))} ↗</a>
          </div>
        </li>`;
      })
      .join("");
    ul.querySelectorAll("[data-show]").forEach((btn) =>
      btn.addEventListener("click", () => focusPlace(btn.dataset.show))
    );
  }
  drawMarkers(list, catById);
}

// ---------- 4. THE MAP ----------
function initMap() {
  if (typeof L === "undefined") {
    // No internet for the map library: the list still works.
    document.getElementById("map").innerHTML = '<p class="map-off">Map unavailable (offline).</p>';
    return;
  }
  map = L.map("map").setView(MANDYA_CENTER, 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
}

function drawMarkers(list, catById) {
  if (!map) return;
  Object.values(markers).forEach((m) => m.remove());
  Object.keys(markers).forEach((k) => delete markers[k]);

  list.forEach((p) => {
    const c = catById[p.category] || {};
    const icon = L.divIcon({
      className: "pin",
      html: `<span style="background:${esc(c.color)}">${esc(c.icon)}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    const m = L.marker([p.lat, p.lng], { icon, title: pick(p, "name"), alt: pick(p, "name") })
      .addTo(map)
      .bindPopup(`<strong>${esc(pick(p, "name"))}</strong><br>${esc(pick(c, "name"))}<br>${esc(t("score", { n: p.score }))}`);
    m.on("click", () => highlightCard(p.id));
    markers[p.id] = m;
  });

  if (state.userPos) {
    markers.__me = L.circleMarker([state.userPos.lat, state.userPos.lng], {
      radius: 9, color: "#fff", weight: 3, fillColor: "#1c7ed6", fillOpacity: 1,
    }).addTo(map);
  }

  // Zoom the map so every shown pin fits
  const pts = list.map((p) => [p.lat, p.lng]);
  if (pts.length === 1) map.setView(pts[0], 16);
  else if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
}

function focusPlace(id) {
  const m = markers[id];
  if (!m) return;
  map.setView(m.getLatLng(), 17);
  m.openPopup();
  highlightCard(id);
  if (window.innerWidth < 900) document.getElementById("map").scrollIntoView({ behavior: "smooth" });
}

function highlightCard(id) {
  document.querySelectorAll(".card.active").forEach((c) => c.classList.remove("active"));
  const card = document.getElementById("card-" + id);
  if (card) {
    card.classList.add("active");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// ---------- 5. LANGUAGE, CONTRAST, LOCATION ----------
function applyLanguage() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.getElementById("search").placeholder = t("searchPlaceholder");
  const langBtn = document.getElementById("lang-btn");
  langBtn.textContent = t("langBtn");
  langBtn.lang = state.lang === "en" ? "kn" : "en";
  document.getElementById("contrast-btn").textContent = state.highContrast ? t("contrastOn") : t("contrastOff");
  document.getElementById("data-badge").textContent = dataSource === "supabase" ? t("dataSupabase") : t("dataSample");
  buildCategoryChips();
  buildFeatureBoxes();
  render();
}

function useMyLocation() {
  const status = document.getElementById("loc-status");
  if (!navigator.geolocation) {
    status.textContent = t("locFail");
    return;
  }
  status.textContent = t("locating");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.sort = "nearest";
      document.getElementById("sort").value = "nearest";
      status.textContent = t("located");
      render();
    },
    () => {
      state.userPos = null;
      state.sort = "name";
      document.getElementById("sort").value = "name";
      status.textContent = t("locFail");
      render();
    },
    { timeout: 10000 }
  );
}

// ---------- 6. START ----------
async function start() {
  // Remember high contrast between visits (if the browser allows it)
  try { state.highContrast = localStorage.getItem("hc") === "1"; } catch (e) {}
  document.body.classList.toggle("hc", state.highContrast);
  document.getElementById("contrast-btn").setAttribute("aria-pressed", state.highContrast);

  initMap();
  await loadData();

  document.getElementById("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });
  document.getElementById("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    if (state.sort === "nearest" && !state.userPos) useMyLocation();
    else render();
  });
  document.getElementById("near-btn").addEventListener("click", useMyLocation);
  document.getElementById("clear-btn").addEventListener("click", () => {
    state.query = "";
    state.category = "all";
    state.features = [];
    document.getElementById("search").value = "";
    buildCategoryChips();
    buildFeatureBoxes();
    render();
  });
  document.getElementById("lang-btn").addEventListener("click", () => {
    state.lang = state.lang === "en" ? "kn" : "en";
    applyLanguage();
  });
  document.getElementById("contrast-btn").addEventListener("click", (e) => {
    state.highContrast = !state.highContrast;
    document.body.classList.toggle("hc", state.highContrast);
    e.currentTarget.setAttribute("aria-pressed", state.highContrast);
    try { localStorage.setItem("hc", state.highContrast ? "1" : "0"); } catch (err) {}
    applyLanguage();
  });

  applyLanguage(); // draws everything for the first time
}

start();
