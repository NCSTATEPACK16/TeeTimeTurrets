[out:json][timeout:180];
(
  nwr["golf"](around:2500,36.43859037,-79.31937903);
  nwr["leisure"="golf_course"](around:2500,36.43859037,-79.31937903);
  nwr["natural"="water"](around:2500,36.43859037,-79.31937903);
  nwr["water"](around:2500,36.43859037,-79.31937903);
  nwr["landuse"~"^(reservoir|basin|forest|grass|meadow)$"](around:2500,36.43859037,-79.31937903);
  way["waterway"](around:2500,36.43859037,-79.31937903);
  nwr["natural"~"^(wood|scrub|wetland)$"](around:2500,36.43859037,-79.31937903);
  way["highway"](around:2500,36.43859037,-79.31937903);
  way["bridge"](around:2500,36.43859037,-79.31937903);
  nwr["building"](around:2500,36.43859037,-79.31937903);
  nwr["man_made"~"^(tower|mast)$"](around:2500,36.43859037,-79.31937903);
);
out geom;
