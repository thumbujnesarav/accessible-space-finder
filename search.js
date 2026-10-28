// =====================================================================
// search.js: the "brain" of the website.
// It decides WHICH places to show and in WHAT ORDER.
// It has no buttons or HTML in it, so it is easy to test and explain.
// =====================================================================

// The 5 accessibility filters. "key" is the column name in the database.
// test(place) returns true when the place HAS that feature.
const FEATURES = [
  { key: "has_ramp",     test: (p) => p.has_ramp },
  { key: "wheelchair",   test: (p) => p.wheelchair === "yes" },   // "limited" does NOT count
  { key: "has_lighting", test: (p) => p.has_lighting },
  { key: "has_seating",  test: (p) => p.has_seating },
  { key: "has_toilet",   test: (p) => p.has_toilet },
];

// Makes text easy to compare: lower case, no extra spaces.
// "  Gandhi   BHAVAN " -> "gandhi bhavan"
function normalise(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Does the place match what the user typed?
// We look in the English AND Kannada name, area and category name,
// so typing "toilet" or "ಶೌಚಾಲಯ" both work. Every word must match.
function matchesText(place, query, categoriesById) {
  const q = normalise(query);
  if (q === "") return true; // empty search box = everything matches
  const cat = categoriesById[place.category] || {};
  const haystack = normalise([
    place.name_en, place.name_kn, place.area_en, place.area_kn,
    cat.name_en, cat.name_kn,
  ].join(" "));
  return q.split(" ").every((word) => haystack.includes(word));
}

// Does the place have EVERY ticked feature? (AND, not OR)
function matchesFeatures(place, tickedKeys) {
  return tickedKeys.every((key) => {
    const feature = FEATURES.find((f) => f.key === key);
    return feature ? feature.test(place) : true;
  });
}

// How many of the 5 features does the place have? (0 to 5)
function accessScore(place) {
  return FEATURES.filter((f) => f.test(place)).length;
}

// Straight-line distance in km between two map points (the "haversine" formula).
// Earth is treated as a ball with radius 6371 km.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The main function. Takes all places + what the user chose, returns the list to show.
// state = { query, category ("all" or an id), features: [...keys], sort, userPos: {lat,lng} | null, lang }
function findPlaces(places, categories, state) {
  const categoriesById = {};
  categories.forEach((c) => (categoriesById[c.id] = c));

  // Step 1: FILTER (keep only places that pass all three checks)
  let result = places.filter(
    (p) =>
      (state.category === "all" || p.category === state.category) &&
      matchesText(p, state.query, categoriesById) &&
      matchesFeatures(p, state.features)
  );

  // Step 2: add extra info we need for showing and sorting
  result = result.map((p) => ({
    ...p,
    score: accessScore(p),
    distance: state.userPos
      ? distanceKm(state.userPos.lat, state.userPos.lng, p.lat, p.lng)
      : null,
  }));

  // Step 3: SORT
  const nameKey = state.lang === "kn" ? "name_kn" : "name_en";
  const byName = (a, b) => a[nameKey].localeCompare(b[nameKey], state.lang === "kn" ? "kn" : "en");
  if (state.sort === "nearest" && state.userPos) {
    result.sort((a, b) => a.distance - b.distance);
  } else if (state.sort === "accessible") {
    result.sort((a, b) => b.score - a.score || byName(a, b)); // most features first, then A-Z
  } else {
    result.sort(byName);
  }
  return result;
}

// Lets the test script (Node.js) use these functions too. Browsers ignore this.
if (typeof module !== "undefined") {
  module.exports = { FEATURES, normalise, matchesText, matchesFeatures, accessScore, distanceKm, findPlaces };
}
