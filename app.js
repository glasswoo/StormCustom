const SHEET_WIDTH = 2048;
const SHEET_HEIGHT = 1448;
const ENABLE_3D_VIEW = false;
const SHOE_PREVIEW_VIEWBOXES = {
  speed: "120 610 1115 760",
  slalom: "120 610 1115 760",
};
const MATERIALS_JSON_PATH = "images/materials/colors.json";

const zoneLabels = {
  speed: {
    A: "主鞋面 / 鞋舌",
    B: "鞋蓋",
    C: "後跟 / 飾線",
  },
  slalom: {
    A: "鞋身 / 固定帶",
    B: "內襯 / 鞋頭",
    C: "備用區",
  },
};

const formFieldKeys = [
  "date",
  "team",
  "athlete",
  "orderNo",
  "footLength",
  "allowance",
  "mount",
  "embroidery",
  "notes",
];

let palette = [];

function blankZoneMaterial() {
  return {
    number: null,
    code: "",
    name: "",
    color: "",
    image: "",
  };
}

function initialZones() {
  return {
    A: blankZoneMaterial(),
    B: blankZoneMaterial(),
    C: blankZoneMaterial(),
  };
}

function defaultZoneNumber() {
  return null;
}

function isBlankZoneState(data) {
  return !data || (data.number == null && !data.color);
}

function zoneMaterialData(zoneState) {
  if (!zoneState) {
    return zoneState;
  }

  if (zoneState.number === null || zoneState.number === undefined) {
    return zoneState;
  }

  return paletteItemForCode(zoneState.number) || zoneState;
}

const state = {
  model: "speed",
  activeZone: "A",
  fields: {
    date: new Date().toISOString().slice(0, 10),
    team: "",
    athlete: "",
    orderNo: "",
    footLength: "",
    allowance: "",
    mount: "",
    embroidery: "",
    notes: "",
  },
  zones: initialZones(),
};

const els = {};
let currentSheetSvg = "";
let renderer;
let scene;
let camera;
let shoeGroup;
let zoneMaterials = {};
let dragState = null;
let animationId = 0;

async function init() {
  cacheElements();
  await loadPalette();
  applyInitialUrlOverrides();
  syncFormInputsFromState();
  updateMountFieldState();
  bindFormFields();
  bindActions();
  renderSwatches();
  setModelButtonState();
  renderZoneTabs();
  syncControlsFromState();
  void renderSheet();
  if (ENABLE_3D_VIEW) {
    initThree();
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }

  window.addEventListener("popstate", () => {
    applyInitialUrlOverrides();
    setModelButtonState();
    if (!activeZones().includes(state.activeZone)) {
      state.activeZone = "A";
    }
    renderZoneTabs();
    syncFormInputsFromState();
    syncControlsFromState();
    void renderSheet();
    setModelButtonState();
    updateMountFieldState();
    if (ENABLE_3D_VIEW) {
      rebuildShoe();
    }
  });
}

async function loadPalette() {
  try {
    const response = await fetch(MATERIALS_JSON_PATH, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("無法載入材質顏色設定");
    }
    const materials = await response.json();
    palette = normalizePalette(materials);
  } catch (error) {
    console.error(error);
    palette = [];
  }
}

function normalizePalette(materials) {
  return (Array.isArray(materials) ? materials : [])
    .map((item) => {
      const number = Number(item.number);
      if (!Number.isInteger(number) || number < 0) {
        return null;
      }
      const color = String(item.color || "#f8f7f2").trim();
      return {
        number,
        name: String(item.name || "").trim(),
        image: String(item.image || "").trim(),
        color: isValidHexColor(color) ? normalizeColor(color) : "#f8f7f2",
      };
    })
    .filter((item) => item && item.name && item.image);
}

function applyInitialUrlOverrides() {
  state.zones = initialZones();

  const params = new URLSearchParams(window.location.search);
  const model = params.get("model");
  if (model === "speed" || model === "slalom") {
    state.model = model;
  }

  state.fields.mount = modelDefaultMount(state.model);

  const mountFromQuery = params.get("mount");
  if (mountFromQuery) {
    const mountValue = parseMountValue(state.model, mountFromQuery);
    if (mountValue) {
      state.fields.mount = mountValue;
    }
  }

  ["A", "B", "C"].forEach((zone) => {
    const value = params.get(zone.toLowerCase()) || params.get(zone);
    if (value) {
      setZoneMaterialFromUrl(zone, value);
    }
  });

  formFieldKeys.forEach((field) => {
    const value = params.get(field);
    if (value !== null) {
      state.fields[field] = value;
    }
  });
}

function parseMountValue(model, value) {
  if (model === "slalom") {
    return modelDefaultMount(model);
  }

  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }

  if (["165", "180", "195"].includes(normalized)) {
    return normalized;
  }

  if (normalized === "165/180/195") {
    return modelDefaultMount(model);
  }

  return "";
}

function currentDayString() {
  return new Date().toISOString().slice(0, 10);
}

function modelDefaultMount(model) {
  return model === "slalom" ? "165" : "";
}

function isDefaultFieldForShare(field, value, model) {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  if (field === "mount") {
    return value === modelDefaultMount(model);
  }

  if (field === "date") {
    return value === currentDayString();
  }

  return false;
}

function isDefaultZoneForShare(zone, model) {
  return state.zones[zone].number === defaultZoneNumber();
}

function readUrlColor(value) {
  if (!value) {
    return "";
  }
  const normalized = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized) ? `#${normalized}` : "";
}

function cacheElements() {
  els.zoneTabs = document.getElementById("zoneTabs");
  els.zoneHint = document.getElementById("zoneHint");
  els.materialDisplayText = document.getElementById("materialDisplayText");
  els.swatchGrid = document.getElementById("swatchGrid");
  els.render2dPreview = document.getElementById("render2dPreview");
  els.sheetPreview = document.getElementById("sheetPreview");
  els.canvas = document.getElementById("shoeCanvas");
  els.renderFallback = document.getElementById("renderFallback");
  els.exportPngButton = document.getElementById("exportPngButton");
  els.exportPdfButton = document.getElementById("exportPdfButton");
  els.resetViewButton = document.getElementById("resetViewButton");
  els.modelButtons = [...document.querySelectorAll("[data-model]")];
  els.formFields = [...document.querySelectorAll("[data-field]")];
  els.copyShareButton = document.getElementById("copyShareButton");
}

function bindFormFields() {
  els.formFields.forEach((input) => {
    const key = input.dataset.field;
    input.value = state.fields[key];
    input.addEventListener("input", () => {
      state.fields[key] = input.value;
      renderSheet();
    });
  });
}

function bindActions() {
  els.modelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.model = button.dataset.model;
      if (!activeZones().includes(state.activeZone)) {
        state.activeZone = "A";
      }
      state.fields.mount = modelDefaultMount(state.model);
      updateFieldInput("mount", state.fields.mount);
      updateMountFieldState();
      renderZoneTabs();
      syncControlsFromState();
      renderSheet();
      if (ENABLE_3D_VIEW) {
        rebuildShoe();
      }
      setModelButtonState();
    });
  });

  els.exportPngButton.addEventListener("click", exportPng);
  els.exportPdfButton.addEventListener("click", exportPdf);
  els.resetViewButton.addEventListener("click", resetCameraView);
  if (els.copyShareButton) {
    els.copyShareButton.addEventListener("click", copyShareUrl);
  }
}

function updateFieldInput(key, value) {
  const input = els.formFields.find((field) => field.dataset.field === key);
  if (input) {
    input.value = value;
  }
}

function syncFormInputsFromState() {
  els.formFields.forEach((input) => {
    const key = input.dataset.field;
    if (key in state.fields) {
      input.value = state.fields[key];
    }
  });
}

function setModelButtonState() {
  els.modelButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.model === state.model);
  });
}

function updateMountFieldState() {
  const mountField = els.formFields.find((field) => field.dataset.field === "mount");
  if (!mountField) {
    return;
  }

  if (state.model === "slalom") {
    state.fields.mount = modelDefaultMount("slalom");
    mountField.value = state.fields.mount;
    mountField.disabled = true;
    mountField.setAttribute("title", "速樁鞋孔距為固定設定");
    return;
  }

  mountField.disabled = false;
  mountField.removeAttribute("title");
  mountField.value = state.fields.mount;
}

function activeZones() {
  return state.model === "speed" ? ["A", "B", "C"] : ["A", "B"];
}

function renderZoneTabs() {
  const visibleZones = activeZones();
  els.zoneHint.textContent =
    state.model === "speed" ? "競速鞋使用 A / B / C 三區" : "速樁鞋使用 A / B 兩區";

  els.zoneTabs.innerHTML = ["A", "B", "C"]
    .map((zone) => {
      const data = state.zones[zone];
      const hiddenClass = visibleZones.includes(zone) ? "" : " is-hidden";
      const activeClass = state.activeZone === zone ? " is-active" : "";

      return `
        <button class="zone-button${activeClass}${hiddenClass}" data-zone="${zone}" type="button">
          <span class="zone-sample" style="${escapeAttr(materialPreviewStyle(data))}"></span>
          <span>${zone} ${escapeHtml(zoneLabels[state.model][zone])}</span>
        </button>
      `;
    })
    .join("");

  els.zoneTabs.querySelectorAll("[data-zone]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeZone = button.dataset.zone;
      renderZoneTabs();
      syncControlsFromState();
    });
  });
}

function renderSwatches() {
  els.swatchGrid.innerHTML = palette
    .map(
      (item) => `
        <button
          class="swatch-button"
          style="${escapeAttr(materialPreviewStyle(item))}"
          data-material-code="${materialCode(item.number)}"
          title="${escapeHtml(materialLabel(item))}"
          aria-label="${escapeHtml(materialLabel(item))}"
          aria-pressed="false"
          type="button"
        ></button>
      `,
    )
    .join("");

  els.swatchGrid.querySelectorAll("[data-material-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = paletteItemForCode(button.dataset.materialCode);
      if (!item) {
        return;
      }
      applyPaletteItemToZone(state.activeZone, item);
      syncControlsFromState();
      updateThreeMaterials();
      renderZoneTabs();
      void renderSheet();
    });
  });
}

function syncControlsFromState() {
  const zone = state.zones[state.activeZone];
  els.materialDisplayText.textContent = materialLabel(zone);
  updateSwatchSelection();
}

function setZoneMaterialFromUrl(zone, value) {
  const code = parseZoneSelection(value);
  const item = Number.isFinite(code) ? paletteItemForCode(code) : null;
  if (item) {
    applyPaletteItemToZone(zone, item);
    return;
  }

  const color = readUrlColor(value);
  if (color) {
    setZoneColor(zone, color);
  }
}

function setZoneColor(zone, color) {
  const item = paletteItemForColor(color);
  if (item) {
    applyPaletteItemToZone(zone, item);
    return;
  }
  state.zones[zone].number = null;
  state.zones[zone].code = "--";
  state.zones[zone].name = "自訂色";
  state.zones[zone].color = color;
  state.zones[zone].image = "";
}

function applyPaletteItemToZone(zone, item) {
  state.zones[zone].number = item.number;
  state.zones[zone].code = materialCode(item.number);
  state.zones[zone].name = item.name;
  state.zones[zone].color = item.color;
  state.zones[zone].image = item.image;
}

function paletteItemForColor(color) {
  const normalized = normalizeColor(color);
  return palette.find((item) => normalizeColor(item.color) === normalized);
}

function paletteItemForCode(value) {
  const number = materialNumber(value);
  return palette.find((item) => item.number === number);
}

function materialLabel(data) {
  if (isBlankZoneState(data)) {
    return "尚未選色";
  }
  const material = zoneMaterialData(data);
  return `${zoneDisplayCode(data)}/${material?.name || "自訂色"}`;
}

function zoneDisplayCode(data) {
  if (!data) {
    return "--";
  }
  if (data.number !== null && data.number !== undefined) {
    return materialCode(data.number);
  }
  return data.code || "--";
}

function materialNumber(value) {
  const number = Number.parseInt(String(value ?? "").replace(/^0+/, "0"), 10);
  return Number.isFinite(number) && number >= 0 ? number : NaN;
}

function materialCode(value) {
  const number = Number.isInteger(value) ? value : materialNumber(value);
  return Number.isFinite(number) && number >= 0 ? String(number).padStart(2, "0") : "";
}

function parseZoneSelection(value) {
  if (!value) {
    return "";
  }

  const raw = String(value).trim();
  if (!raw) {
    return "";
  }

  const [codeToken] = raw.split(/[-_]/, 2);
  const number = materialNumber(codeToken);
  return Number.isFinite(number) ? number : "";
}

function materialPreviewStyle(item) {
  if (isBlankZoneState(item)) {
    return "background-color:#fff;background-image:repeating-linear-gradient(135deg, rgba(36,23,21,0.22) 0 2px, transparent 2px 7px);";
  }
  const resolved = zoneMaterialData(item);
  const backgroundColor = `background-color:${resolved?.color || "#fffdf9"}`;
  if (!resolved?.image) {
    return backgroundColor;
  }
  const imageUrl = materialImageHref(resolved.image);
  return `${backgroundColor};background-image:url('${escapeAttr(imageUrl)}');background-size:cover;background-position:center;`;
}

function updateSwatchSelection() {
  const active = state.zones[state.activeZone];
  const selectedCode = active.code;
  els.swatchGrid.querySelectorAll("[data-material-code]").forEach((button) => {
    const isSelected = button.dataset.materialCode === selectedCode;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

function initThree() {
  if (!window.THREE) {
    els.renderFallback.hidden = false;
    els.renderFallback.textContent = "無法載入 3D 模組，請確認網路連線";
    return;
  }

  renderer = new THREE.WebGLRenderer({
    canvas: els.canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ("outputColorSpace" in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b5a52, 2.8);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(5, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xcbe4ff, 1.2);
  fill.position.set(-5, 3, 4);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(4.4, 72),
    new THREE.MeshBasicMaterial({
      color: 0x241715,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.05;
  ground.scale.set(1.5, 0.38, 1);
  scene.add(ground);

  createMaterials();
  rebuildShoe();
  bindCanvasInteraction();
  resizeRenderer();
  resetCameraView();
  window.addEventListener("resize", resizeRenderer);
  animate();
}

function createMaterials() {
  const carbonTexture = createCarbonTexture();
  zoneMaterials = {
    A: new THREE.MeshPhysicalMaterial({ roughness: 0.58, metalness: 0.02, clearcoat: 0.28 }),
    B: new THREE.MeshPhysicalMaterial({ roughness: 0.62, metalness: 0.02, clearcoat: 0.18 }),
    C: new THREE.MeshPhysicalMaterial({ roughness: 0.56, metalness: 0.02, clearcoat: 0.24 }),
    sole: new THREE.MeshPhysicalMaterial({
      color: 0x191716,
      map: carbonTexture,
      roughness: 0.48,
      metalness: 0.08,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
    }),
    trim: new THREE.MeshPhysicalMaterial({
      color: 0x3a3331,
      roughness: 0.68,
      metalness: 0.04,
    }),
    rubber: new THREE.MeshPhysicalMaterial({
      color: 0x151313,
      roughness: 0.82,
      metalness: 0.02,
    }),
    metal: new THREE.MeshPhysicalMaterial({
      color: 0xb6b0a8,
      roughness: 0.33,
      metalness: 0.42,
    }),
  };
  updateThreeMaterials();
}

function createCarbonTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = -128; y < 256; y += 18) {
    for (let x = -128; x < 256; x += 18) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "rgba(255,255,255,0.13)";
      ctx.fillRect(0, 0, 13, 5);
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      ctx.fillRect(0, 7, 13, 5);
      ctx.restore();
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = -128; i < 256; i += 24) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.4, 1.7);
  if ("colorSpace" in texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

function updateThreeMaterials() {
  if (!window.THREE || !zoneMaterials.A) {
    return;
  }

  ["A", "B", "C"].forEach((zone) => {
    const data = state.zones[zone];
    if (!data) {
      return;
    }
    const material = zoneMaterials[zone];
    applyZoneMaterialSettings(material);
    material.color.set(data.color);
    if (material.map) {
      material.map.dispose();
      material.map = null;
    }
    if (data.image) {
      const texture = new THREE.TextureLoader().load(materialImageHref(data.image), () => {
        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
      });
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.6, 1.8);
      if ("colorSpace" in texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      material.map = texture;
    }
    material.needsUpdate = true;
  });
}

function applyZoneMaterialSettings(material) {
  const settings = {
    roughness: 0.62,
    metalness: 0.01,
    clearcoat: 0.16,
    clearcoatRoughness: 0.3,
  };
  material.roughness = settings.roughness;
  material.metalness = settings.metalness;
  material.clearcoat = settings.clearcoat;
  material.clearcoatRoughness = settings.clearcoatRoughness;
}

function rebuildShoe() {
  if (!scene || !window.THREE) {
    return;
  }

  if (shoeGroup) {
    scene.remove(shoeGroup);
  }

  shoeGroup = new THREE.Group();
  shoeGroup.rotation.set(0.06, -0.16, 0);

  if (state.model === "speed") {
    buildSpeedBoot(shoeGroup);
  } else {
    buildSlalomBoot(shoeGroup);
  }

  scene.add(shoeGroup);
}

function buildSpeedBoot(group) {
  const depth = 0.96;

  addCurvedExtruded(group, [
    ["M", -3.34, -0.78],
    ["Q", -2.4, -1.1, -0.55, -1.1],
    ["Q", 1.7, -1.08, 3.16, -0.66],
    ["Q", 3.55, -0.53, 3.35, -0.28],
    ["Q", 1.68, -0.48, 0.16, -0.58],
    ["Q", -1.74, -0.68, -3.08, -0.34],
    ["Q", -3.36, -0.46, -3.34, -0.78],
  ], 0.48, zoneMaterials.sole, -0.28, { edgeOpacity: 0.34 });

  addCurvedExtruded(group, [
    ["M", -3.08, -0.4],
    ["Q", -2.82, 0.48, -2.04, 0.82],
    ["Q", -1.08, 1.24, -0.08, 0.86],
    ["Q", 0.96, 0.45, 2.04, 0.04],
    ["Q", 2.96, -0.26, 3.36, -0.42],
    ["Q", 3.18, -0.78, 2.64, -0.88],
    ["Q", 1.18, -1.08, -0.72, -0.95],
    ["Q", -2.34, -0.86, -3.08, -0.4],
  ], depth, zoneMaterials.A, -0.02, { edgeOpacity: 0.5 });

  addCurvedExtruded(group, [
    ["M", -3.1, -0.36],
    ["Q", -2.98, 0.84, -2.28, 1.45],
    ["Q", -1.46, 2.02, -0.58, 1.46],
    ["Q", -0.78, 1.02, -1.3, 0.92],
    ["Q", -2.14, 0.8, -2.42, 0.2],
    ["Q", -2.58, -0.2, -3.1, -0.36],
  ], 0.9, zoneMaterials.C, 0.04, { edgeOpacity: 0.48 });

  addCurvedExtruded(group, [
    ["M", -2.86, 0.98],
    ["Q", -2.12, 1.32, -1.28, 1.34],
    ["Q", -0.62, 1.34, -0.24, 1.08],
    ["L", -0.36, 0.92],
    ["Q", -1.24, 1.1, -2.32, 1.04],
    ["Q", -2.68, 1.04, -2.86, 0.98],
  ], 0.82, zoneMaterials.C, 0.08, { bevelSize: 0.02, edgeOpacity: 0.34 });

  addCurvedExtruded(group, [
    ["M", 1.94, -0.04],
    ["Q", 2.8, -0.16, 3.38, -0.42],
    ["Q", 3.34, -0.78, 2.68, -0.88],
    ["Q", 2.1, -0.86, 1.88, -0.66],
    ["Q", 1.74, -0.34, 1.94, -0.04],
  ], 0.98, zoneMaterials.C, 0.08, { edgeOpacity: 0.48 });

  addCurvedExtruded(group, [
    ["M", -0.86, 0.96],
    ["Q", -0.1, 1.1, 0.56, 0.72],
    ["Q", 0.66, 0.42, 0.42, 0.18],
    ["Q", -0.26, 0.1, -0.92, 0.34],
    ["Q", -1.02, 0.7, -0.86, 0.96],
  ], 0.98, zoneMaterials.B, 0.12, { edgeOpacity: 0.4 });

  addCurvedExtruded(group, [
    ["M", -0.02, 0.45],
    ["Q", 0.74, 0.22, 1.66, -0.08],
    ["Q", 2.36, -0.3, 2.52, -0.46],
    ["L", 2.2, -0.62],
    ["Q", 1.12, -0.36, -0.14, -0.02],
  ], 0.9, zoneMaterials.A, 0.16, { bevelSize: 0.02, edgeOpacity: 0.32 });

  addCurvedExtruded(group, [
    ["M", 0.18, 0.34],
    ["Q", 1.12, 0.16, 2.48, -0.24],
    ["L", 2.54, -0.38],
    ["Q", 1.16, -0.18, 0.08, 0.12],
  ], 0.1, zoneMaterials.trim, 0.58, { bevelSize: 0.01, edgeOpacity: 0.18 });

  addCurvedExtruded(group, [
    ["M", -2.98, -0.42],
    ["Q", -2.72, 0.12, -2.28, 0.18],
    ["Q", -1.82, 0.12, -1.56, -0.18],
    ["Q", -1.66, -0.58, -2.16, -0.72],
    ["Q", -2.72, -0.66, -2.98, -0.42],
  ], 0.98, zoneMaterials.sole, 0.1, { edgeOpacity: 0.32 });

  addRatchetBuckle(group, -2.34, -0.28, 0.66);
  addSpeedEyelets(group);

  addSeam(group, [
    [-2.85, -0.2],
    [-2.28, 0.76],
    [-1.26, 0.92],
    [-0.28, 0.66],
  ], 0.61, 0x241715, 0.46);
  addSeam(group, [
    [-2.7, -0.58],
    [-1.18, -0.72],
    [0.92, -0.78],
    [2.74, -0.62],
  ], 0.61, 0xffffff, 0.56);
  addSeam(group, [
    [-2.6, 1.12],
    [-1.92, 1.42],
    [-0.72, 1.18],
  ], 0.62, 0xffffff, 0.5);

  addLogo(group, "Storm", 0.92, -0.42, 0.68, 0.95, -0.16);
  addLogo(group, "STORM", -0.22, 0.58, 0.67, 0.72, -0.08);
  addZoneMark(group, "A", 0.58, -0.58, 0.66);
  addZoneMark(group, "B", -0.24, 0.62, 0.7);
  addZoneMark(group, "C", -2.3, 0.92, 0.66);
}

function buildSlalomBoot(group) {
  const depth = 0.94;
  addExtruded(group, [
    [-3.1, -0.86],
    [-1.95, -1.05],
    [0.85, -1.06],
    [2.62, -0.83],
    [3.25, -0.45],
    [3.08, -0.22],
    [1.05, -0.36],
    [-1.55, -0.35],
    [-2.98, -0.55],
  ], 0.44, zoneMaterials.sole, -0.22);

  addExtruded(group, [
    [-3.05, -0.55],
    [-2.86, 1.15],
    [-2.24, 2.03],
    [-1.12, 2.16],
    [-0.28, 1.76],
    [0.2, 0.86],
    [1.65, 0.18],
    [3.26, -0.24],
    [3.02, -0.78],
    [1.08, -0.96],
    [-1.28, -0.82],
    [-2.72, -0.64],
  ], depth, zoneMaterials.A);

  addExtruded(group, [
    [-2.92, 0.42],
    [-2.5, 1.78],
    [-1.2, 1.98],
    [0.02, 1.56],
    [-0.15, 1.25],
    [-1.15, 1.45],
    [-2.38, 1.2],
    [-2.6, 0.28],
  ], 0.9, zoneMaterials.B, 0.02);

  addExtruded(group, [
    [-2.72, 1.0],
    [-1.05, 1.18],
    [0.35, 0.62],
    [0.22, 0.18],
    [-1.28, 0.56],
    [-2.8, 0.38],
  ], 1.02, zoneMaterials.B, 0.09);

  addExtruded(group, [
    [-2.62, 0.16],
    [-1.15, 0.36],
    [0.68, -0.08],
    [0.92, -0.38],
    [-1.12, -0.22],
    [-2.74, -0.4],
  ], 1.04, zoneMaterials.A, 0.12);

  addExtruded(group, [
    [1.52, -0.02],
    [3.24, -0.26],
    [3.02, -0.72],
    [1.62, -0.66],
  ], 0.97, zoneMaterials.B, 0.08);

  addExtruded(group, [
    [-3.04, -0.58],
    [-2.78, 0.28],
    [-2.2, 0.22],
    [-2.28, -0.72],
  ], 1.0, zoneMaterials.rubber, 0.12);

  addBuckle(group, -2.02, -0.28, 0.64);
  addEyelets(group, [
    [1.02, -0.08],
    [1.55, -0.2],
    [2.08, -0.31],
    [2.6, -0.43],
  ]);
  addLogo(group, "STORM", -0.05, 0.28, 0.56, 1.08, -0.38);
  addZoneMark(group, "A", 0.28, -0.54, 0.57);
  addZoneMark(group, "B", -1.55, 1.42, 0.56);
}

function addCurvedExtruded(group, commands, depth, material, zOffset = 0, options = {}) {
  const shape = new THREE.Shape();
  commands.forEach((command) => {
    const [type, ...values] = command;
    if (type === "M") {
      shape.moveTo(values[0], values[1]);
    } else if (type === "L") {
      shape.lineTo(values[0], values[1]);
    } else if (type === "Q") {
      shape.quadraticCurveTo(values[0], values[1], values[2], values[3]);
    } else if (type === "C") {
      shape.bezierCurveTo(values[0], values[1], values[2], values[3], values[4], values[5]);
    }
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: options.bevelThickness ?? 0.032,
    bevelSize: options.bevelSize ?? 0.04,
    bevelSegments: options.bevelSegments ?? 6,
    curveSegments: 24,
  });
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -depth / 2 + zOffset;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edgeOpacity = options.edgeOpacity ?? 0.5;
  if (edgeOpacity > 0) {
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 20),
      new THREE.LineBasicMaterial({ color: 0x241715, transparent: true, opacity: edgeOpacity }),
    );
    edge.position.copy(mesh.position);
    group.add(edge);
  }

  return mesh;
}

function addExtruded(group, points, depth, material, zOffset = 0) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.045,
    bevelSegments: 5,
    curveSegments: 16,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -depth / 2 + zOffset;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 18),
    new THREE.LineBasicMaterial({ color: 0x241715, transparent: true, opacity: 0.62 }),
  );
  edge.position.copy(mesh.position);
  group.add(edge);
  return mesh;
}

function addSeam(group, points, z = 0.6, color = 0x241715, opacity = 0.45) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y]) => new THREE.Vector3(x, y, z)),
  );
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    }),
  );
  group.add(line);
  return line;
}

function addSpeedEyelets(group) {
  addEyelets(group, [
    [0.86, 0.28],
    [1.34, 0.1],
    [1.84, -0.06],
    [2.32, -0.22],
  ]);

  const stitchMaterial = new THREE.MeshBasicMaterial({ color: 0x241715, transparent: true, opacity: 0.45 });
  [
    [0.68, 0.42],
    [1.18, 0.22],
    [1.68, 0.06],
    [2.16, -0.1],
    [2.62, -0.28],
  ].forEach(([x, y]) => {
    const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.012), stitchMaterial);
    stitch.position.set(x, y, 0.64);
    stitch.rotation.z = -0.34;
    group.add(stitch);
  });
}

function addRatchetBuckle(group, x, y, z) {
  addCurvedExtruded(group, [
    ["M", x - 0.36, y - 0.2],
    ["Q", x - 0.1, y - 0.1, x + 0.34, y - 0.16],
    ["L", x + 0.38, y + 0.06],
    ["Q", x - 0.08, y + 0.2, x - 0.44, y + 0.1],
  ], 0.1, zoneMaterials.rubber, z, { bevelSize: 0.016, edgeOpacity: 0.22 });

  addCurvedExtruded(group, [
    ["M", x - 0.18, y - 0.07],
    ["L", x + 0.16, y - 0.1],
    ["L", x + 0.18, y + 0.06],
    ["L", x - 0.14, y + 0.1],
  ], 0.1, zoneMaterials.metal, z + 0.08, { bevelSize: 0.01, edgeOpacity: 0.18 });

  const ribMaterial = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.72 });
  for (let index = 0; index < 6; index += 1) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.018), ribMaterial);
    rib.position.set(x + 0.12 + index * 0.055, y - 0.13 + index * 0.014, z + 0.14);
    rib.rotation.z = -0.28;
    group.add(rib);
  }
}

function addBuckle(group, x, y, z) {
  addExtruded(group, [
    [x - 0.48, y - 0.16],
    [x + 0.34, y - 0.28],
    [x + 0.42, y + 0.1],
    [x - 0.38, y + 0.24],
  ], 0.12, zoneMaterials.rubber, z);

  addExtruded(group, [
    [x - 0.25, y - 0.08],
    [x + 0.12, y - 0.12],
    [x + 0.16, y + 0.06],
    [x - 0.2, y + 0.1],
  ], 0.14, zoneMaterials.metal, z + 0.08);
}

function addEyelets(group, positions) {
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0x241715,
    side: THREE.DoubleSide,
  });

  positions.forEach(([x, y]) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.14, 28), ringMaterial);
    ring.position.set(x, y, 0.58);
    group.add(ring);

    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), innerMaterial);
    dot.position.set(x, y, 0.581);
    group.add(dot);
  });
}

function addLogo(group, text, x, y, z, width, rotateZ = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(36,23,21,0.72)";
  ctx.font = "900 76px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 80);

  const texture = new THREE.CanvasTexture(canvas);
  if ("colorSpace" in texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.31), material);
  logo.position.set(x, y, z);
  logo.rotation.z = rotateZ;
  group.add(logo);
}

function addZoneMark(group, text, x, y, z) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#241715";
  ctx.font = "900 82px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), material);
  mark.position.set(x, y, z);
  group.add(mark);
}

function bindCanvasInteraction() {
  const canvas = els.canvas;

  canvas.addEventListener("pointerdown", (event) => {
    dragState = {
      x: event.clientX,
      y: event.clientY,
      rx: shoeGroup.rotation.x,
      ry: shoeGroup.rotation.y,
    };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragState || !shoeGroup) {
      return;
    }
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    shoeGroup.rotation.y = dragState.ry + dx * 0.01;
    shoeGroup.rotation.x = clamp(dragState.rx + dy * 0.006, -0.62, 0.62);
  });

  canvas.addEventListener("pointerup", () => {
    dragState = null;
  });

  canvas.addEventListener("pointercancel", () => {
    dragState = null;
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.08 : 0.92;
      camera.position.multiplyScalar(factor);
      const distance = camera.position.length();
      if (distance < 4.4) {
        camera.position.setLength(4.4);
      }
      if (distance > 15) {
        camera.position.setLength(15);
      }
      camera.lookAt(0, 0.1, 0);
    },
    { passive: false },
  );
}

function resetCameraView() {
  if (!camera || !shoeGroup) {
    return;
  }
  const isNarrow = els.canvas.getBoundingClientRect().width < 560;
  if (isNarrow) {
    camera.position.set(0.6, 1.75, 12.8);
    shoeGroup.scale.setScalar(0.82);
    shoeGroup.position.x = -0.85;
  } else {
    camera.position.set(1.9, 1.45, 7.6);
    shoeGroup.scale.setScalar(1);
    shoeGroup.position.x = 0;
  }
  camera.lookAt(0, 0.1, 0);
  shoeGroup.rotation.set(0.06, -0.16, 0);
}

function resizeRenderer() {
  if (!renderer || !camera) {
    return;
  }
  const rect = els.canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(420, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  animationId = requestAnimationFrame(animate);
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function renderSheet() {
  currentSheetSvg = buildSheetSvg();
  els.sheetPreview.innerHTML = currentSheetSvg;
  render2dPreview();
  updateShareUrlFromState();
}

function buildSheetSvg() {
  const modelTitle = state.model === "speed" ? "競速" : "速樁";
  return buildSelectionSheetSvg({
    viewBox: `0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`,
    ariaLabel: `STORM SKATES ${modelTitle}客製選色單`,
    includeValues: true,
  });
}

function render2dPreview() {
  if (!els.render2dPreview) {
    return;
  }
  const modelTitle = state.model === "speed" ? "競速" : "速樁";
  const viewBox = SHOE_PREVIEW_VIEWBOXES[state.model];
  els.render2dPreview.innerHTML = `
    ${buildSelectionSheetSvg({
      viewBox,
      ariaLabel: `${modelTitle}鞋 2D 選色預覽`,
      includeValues: false,
    })}
  `;
}

function buildSelectionSheetSvg({ viewBox, ariaLabel, includeValues }) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${escapeAttr(ariaLabel)}">
      <defs>
        ${svgDefs()}
      </defs>
      <rect width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" fill="#fffdf9"/>
      ${sheetColorUnderlays()}
      <image href="${escapeAttr(sheetImageHref())}" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" preserveAspectRatio="none" style="mix-blend-mode:multiply"></image>
      ${sheetFixedOverlays()}
      ${includeValues ? sheetValueOverlays() : ""}
    </svg>
  `;
}

function sheetImageHref() {
  const path =
    state.model === "speed"
      ? "images/競速鞋參考圖片/競速鞋選色單.jpg"
      : "images/速樁鞋參考圖片/速樁鞋選色單.jpg";
  return new URL(path, window.location.href).href;
}

function sheetColorUnderlays() {
  const boot = state.model === "speed" ? speedSheetUnderlays() : slalomSheetUnderlays();
  return `
    <g id="color-underlays">
      ${boot}
    </g>
  `;
}

function speedSheetUnderlays() {
  return `
    <g id="speed-zone-underlays">
      ${speedMaskUnderlay("A")}
      ${speedMaskUnderlay("C")}
      ${speedMaskUnderlay("B")}
    </g>
  `;
}

function speedMaskUnderlay(zone) {
  return sheetMaskUnderlay("speed", zone);
}

function sheetMaskUnderlay(model, zone) {
  const fill = bootZoneFill(zone);
  if (fill === "transparent") {
    return "";
  }
  return `<rect x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" fill="${fill}" mask="url(#${model}-mask-${zone})"/>`;
}

function sheetFixedOverlays() {
  if (state.model === "speed") {
    return `
      <g id="fixed-overlays" pointer-events="none">
        ${speedFixedStrapOverlay()}
      </g>
    `;
  }

  if (state.model === "slalom") {
    return `
      <g id="slalom-correction-overlays" pointer-events="none">
        ${slalomAHeelCorrectionOverlay()}
      </g>
    `;
  }

  return "";
}

function speedFixedStrapOverlay() {
  return `
    <image id="speed-fixed-strap-overlay" href="${escapeAttr(fixedOverlayHref("strap"))}" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" preserveAspectRatio="none"></image>
  `;
}

function slalomAHeelCorrectionOverlay() {
  const fill = bootZoneFill("A");
  if (fill === "transparent") {
    return "";
  }
  return `<rect x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" fill="${fill}" mask="url(#slalom-A-heel-correction-mask)"/>`;
}

function speedCarbonUnderlay() {
  return `
    <g id="fixed-carbon-fiber">
      <path d="M214 952 C198 822 232 676 330 570 C300 682 310 820 438 1005 C408 1105 345 1154 282 1120 C230 1092 206 1038 214 952 Z" fill="url(#carbonFiber)"/>
      <path d="M214 952 C198 822 232 676 330 570 C300 682 310 820 438 1005 C408 1105 345 1154 282 1120 C230 1092 206 1038 214 952 Z" fill="url(#carbonShine)" opacity="0.7"/>
      <path d="M274 1028 C398 1108 568 1172 820 1206 C620 1218 392 1162 226 1072 C238 1048 254 1036 274 1028 Z" fill="url(#carbonFiber)"/>
      <path d="M274 1028 C398 1108 568 1172 820 1206 C620 1218 392 1162 226 1072 C238 1048 254 1036 274 1028 Z" fill="url(#carbonShine)" opacity="0.64"/>
    </g>
  `;
}

function slalomSheetUnderlays() {
  return `
    <g id="slalom-zone-underlays">
      ${slalomMaskUnderlay("A")}
      ${slalomFixedRimUnderlay()}
      ${slalomMaskUnderlay("B")}
    </g>
  `;
}

function slalomMaskUnderlay(zone) {
  return sheetMaskUnderlay("slalom", zone);
}

function slalomFixedRimUnderlay() {
  return `<rect x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" fill="#302c2b" mask="url(#slalom-fixed-rim-mask)"/>`;
}

function sheetValueOverlays() {
  return `
    <g id="form-values" font-family="Arial, 'Noto Sans TC', sans-serif" fill="#241715">
      ${sheetText(state.fields.date, 314, 308, 38, 13)}
      ${sheetText(state.fields.team, 780, 308, 38, 13)}
      ${sheetText(state.fields.athlete, 1208, 308, 38, 14)}
      ${sheetText(state.fields.orderNo, 1650, 308, 38, 9)}
      ${sheetText(state.fields.footLength, 314, 432, 38, 8)}
      ${sheetText(state.fields.allowance, 782, 432, 38, 8)}
      ${mountTextOverlay()}
      ${sheetText(state.fields.embroidery, 350, 558, 38, 16)}
      ${sheetText(state.fields.notes, 900, 558, 38, 16)}
      ${materialValueOverlays()}
    </g>
  `;
}

function mountTextOverlay() {
  if (!state.fields.mount || state.model === "slalom") {
    return "";
  }
  return sheetText(state.fields.mount, 1225, 432, 38, 12);
}

function materialValueOverlays() {
  const zones = activeZones();
  const table = state.model === "speed"
    ? { y: 716, row: 190, codeX: 1414, nameCenterX: 1750 }
    : { y: 726, row: 200, codeX: 1350, nameCenterX: 1750 };

  return zones
    .map((zone, index) => {
      const data = state.zones[zone];
      const y = table.y + index * table.row + table.row / 2 + 12;
      const material = zoneMaterialData(data);
      const name = fitText(material ? material.name : data.name, 8);
      const nameMarkup = name
        ? `<text x="${table.nameCenterX}" y="${y}" font-size="36" font-weight="850" text-anchor="middle">${escapeXml(name)}</text>`
        : "";
      return `
        ${sheetText(zoneDisplayCode(data), table.codeX, y, 42, 12)}
        ${nameMarkup}
      `;
    })
    .join("");
}

function sheetText(value, x, y, size, maxLength) {
  const text = fitText(value, maxLength);
  if (!text) {
    return "";
  }
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="850">${escapeXml(text)}</text>`;
}

function svgDefs() {
  return `
    ${materialPatternDefs()}
    ${sheetMaskDefs()}
    <pattern id="carbonFiber" patternUnits="userSpaceOnUse" width="56" height="56" patternTransform="rotate(18)">
      <rect width="56" height="56" fill="#1c1a1a"/>
      <path d="M-12 8 H68 M-12 24 H68 M-12 40 H68" stroke="#090808" stroke-width="10" opacity="0.72"/>
      <path d="M0 0 L56 56 M-28 0 L28 56 M28 0 L84 56" stroke="#5b5754" stroke-width="7" opacity="0.32"/>
      <path d="M0 56 L56 0 M-28 56 L28 0 M28 56 L84 0" stroke="#000" stroke-width="5" opacity="0.4"/>
      <path d="M-12 16 H68 M-12 48 H68" stroke="#77716c" stroke-width="2" opacity="0.28"/>
    </pattern>
    <linearGradient id="carbonShine" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.1"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="24" stdDeviation="18" flood-color="#241715" flood-opacity="0.22"/>
    </filter>
  `;
}

function materialPatternDefs() {
  return activeZones()
    .map((zone) => {
      const data = state.zones[zone];
      if (!data.image) {
        return "";
      }
      return `
        <pattern id="${materialPatternId(zone)}" patternUnits="userSpaceOnUse" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}">
          <image href="${escapeAttr(materialImageHref(data.image))}" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" preserveAspectRatio="none"></image>
        </pattern>
      `;
    })
    .join("");
}

function sheetMaskDefs() {
  const model = state.model;
  const zoneMasks = activeZones()
    .map(
      (zone) => `
        <mask id="${model}-mask-${zone}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" mask-type="luminance" style="mask-type: luminance;">
          <image href="${escapeAttr(maskImageHref(model, zone))}" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" preserveAspectRatio="none"></image>
        </mask>
      `,
    )
    .join("");

  if (model !== "slalom") {
    return zoneMasks;
  }

  return `
    ${zoneMasks}
    <mask id="slalom-fixed-rim-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" mask-type="luminance" style="mask-type: luminance;">
      <image href="${escapeAttr(slalomFixedRimMaskHref())}" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" preserveAspectRatio="none"></image>
    </mask>
    <mask id="slalom-A-heel-correction-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" mask-type="luminance" style="mask-type: luminance;">
      <image href="${escapeAttr(slalomAHeelCorrectionMaskHref())}" x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" preserveAspectRatio="none"></image>
    </mask>
  `;
}

function maskImageHref(model, zone) {
  return new URL(`images/generated-masks/${model}-${zone}.png`, window.location.href).href;
}

function fixedOverlayHref(name) {
  return new URL(`images/generated-masks/speed-fixed-${name}.png`, window.location.href).href;
}

function slalomFixedRimMaskHref() {
  return new URL("images/generated-masks/slalom-fixed-rim.png", window.location.href).href;
}

function slalomAHeelCorrectionMaskHref() {
  return new URL("images/generated-masks/slalom-A-heel-correction.png", window.location.href).href;
}

function fieldLine(label, value, x, y, width, suffix = "") {
  const labelWidth = label.length >= 4 ? 142 : 112;
  const valueX = x + labelWidth + 10;
  const lineX2 = valueX + width;
  const suffixMarkup = suffix
    ? `<text x="${lineX2 + 18}" y="${y}" font-size="52" font-weight="900" fill="#241715">${escapeXml(suffix)}</text>`
    : "";

  return `
    <text x="${x}" y="${y}" font-size="52" font-weight="900" fill="#241715">${escapeXml(label)}</text>
    <line x1="${valueX}" y1="${y + 12}" x2="${lineX2}" y2="${y + 12}" stroke="#241715" stroke-width="2.5"/>
    <text x="${valueX + 8}" y="${y - 9}" font-size="39" font-weight="800" fill="#241715">${escapeXml(fitText(value, 18))}</text>
    ${suffixMarkup}
  `;
}

function materialTableSvg(zones) {
  const x = 1216;
  const y = 730;
  const width = 682;
  const rowHeight = zones.length === 3 ? 190 : 240;
  const height = rowHeight * zones.length;
  const labelWidth = 128;
  const codeWidth = 300;

  const rows = zones
    .map((zone, index) => {
      const data = state.zones[zone];
      const rowY = y + index * rowHeight;
      const material = zoneMaterialData(data);
      return `
        <rect x="${x}" y="${rowY}" width="${labelWidth}" height="${rowHeight}" fill="#fffdf9" stroke="#241715" stroke-width="3"/>
        <rect x="${x + labelWidth}" y="${rowY}" width="${codeWidth}" height="${rowHeight}" fill="#fffdf9" stroke="#241715" stroke-width="3"/>
        <rect x="${x + labelWidth + codeWidth}" y="${rowY}" width="${width - labelWidth - codeWidth}" height="${rowHeight}" fill="#fffdf9" stroke="#241715" stroke-width="3"/>
        <text x="${x + 42}" y="${rowY + rowHeight / 2 + 32}" font-size="88" font-weight="900" fill="#241715">${zone}</text>
        <text x="${x + labelWidth + 34}" y="${rowY + rowHeight / 2 + 12}" font-size="44" font-weight="900" fill="#241715">${escapeXml(fitText(zoneDisplayCode(data), 11))}</text>
        <text x="${x + labelWidth + codeWidth + 34}" y="${rowY + rowHeight / 2 + 12}" font-size="36" font-weight="850" fill="#241715">${escapeXml(fitText(material ? material.name : data.name, 8))}</text>
      `;
    })
    .join("");

  return `
    <text x="${x + 205}" y="${y - 48}" font-size="64" font-weight="900" fill="#241715">料號</text>
    <text x="${x + 488}" y="${y - 48}" font-size="64" font-weight="900" fill="#241715">皮色</text>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#241715" stroke-width="7"/>
    ${rows}
  `;
}

function speedBootSvg() {
  return `
    <g transform="translate(-20,80)" filter="url(#softShadow)">
      <path d="M205 1075 C360 1160 840 1264 1112 1220 C1178 1210 1208 1180 1182 1146 C1060 1160 780 1124 492 1070 C352 1044 258 1038 205 1075 Z" fill="#1f1b1b" opacity="0.72"/>
      <path d="M206 945 C236 795 344 715 520 710 C720 705 1005 835 1182 996 C1230 1040 1220 1102 1152 1135 C925 1212 525 1138 240 1010 C214 998 201 976 206 945 Z" fill="${zoneFill("A")}" stroke="#241715" stroke-width="5"/>
      <path d="M211 942 C256 804 373 752 510 766 C652 780 802 836 960 922" fill="none" stroke="#241715" stroke-width="3" opacity="0.65"/>
      <path d="M212 952 C190 790 234 635 352 548 C492 448 655 510 733 646 C654 630 552 672 468 738 C382 805 302 900 250 1030 Z" fill="${zoneFill("C")}" stroke="#241715" stroke-width="5"/>
      <path d="M412 546 C545 512 668 544 738 646 L687 684 C584 650 480 675 370 748 Z" fill="${zoneFill("C")}" stroke="#241715" stroke-width="4"/>
      <path d="M620 680 L860 790 L957 900 L735 970 C690 920 655 818 620 680 Z" fill="${zoneFill("B")}" stroke="#241715" stroke-width="5"/>
      <path d="M760 840 L1088 930 L1070 990 L712 908 Z" fill="${zoneFill("A")}" stroke="#241715" stroke-width="4"/>
      <path d="M937 930 C1048 956 1148 986 1208 1023 C1196 1094 1145 1130 1063 1140 C1038 1054 1004 992 937 930 Z" fill="${zoneFill("C")}" stroke="#241715" stroke-width="5"/>
      <g>
        <path d="M214 952 C198 822 232 676 330 570 C300 682 310 820 438 1005 C408 1105 345 1154 282 1120 C230 1092 206 1038 214 952 Z" fill="url(#carbonFiber)" stroke="#241715" stroke-width="5"/>
        <path d="M214 952 C198 822 232 676 330 570 C300 682 310 820 438 1005 C408 1105 345 1154 282 1120 C230 1092 206 1038 214 952 Z" fill="url(#carbonShine)" opacity="0.72"/>
        <path d="M276 1028 C398 1108 568 1172 820 1206 C620 1218 392 1162 226 1072 C238 1048 254 1036 276 1028 Z" fill="url(#carbonFiber)" stroke="#241715" stroke-width="4"/>
        <path d="M276 1028 C398 1108 568 1172 820 1206 C620 1218 392 1162 226 1072 C238 1048 254 1036 276 1028 Z" fill="url(#carbonShine)" opacity="0.65"/>
      </g>
      <path d="M272 935 C324 950 374 958 425 963" fill="none" stroke="#241715" stroke-width="3"/>
      <path d="M325 752 C368 828 405 910 438 1005" fill="none" stroke="#241715" stroke-width="3"/>
      <path d="M508 762 C548 864 598 970 664 1090" fill="none" stroke="#241715" stroke-width="3"/>
      <path d="M748 928 C792 1012 858 1102 945 1180" fill="none" stroke="#241715" stroke-width="3"/>
      <g fill="#fffdf9" stroke="#241715" stroke-width="4">
        <circle cx="792" cy="903" r="20"/>
        <circle cx="875" cy="930" r="19"/>
        <circle cx="958" cy="956" r="18"/>
        <circle cx="1040" cy="982" r="17"/>
      </g>
      <path d="M314 920 L426 1026 L375 1066 L265 955 Z" fill="#241715" opacity="0.88"/>
      <path d="M320 940 L472 1052" stroke="#241715" stroke-width="20" stroke-linecap="round"/>
      <text x="650" y="910" transform="rotate(-28 650 910)" font-size="66" font-weight="900" fill="#241715" opacity="0.65">LOGO</text>
      <text x="704" y="1120" font-size="78" font-weight="900" fill="#241715">A</text>
      <text x="805" y="852" font-size="78" font-weight="900" fill="#241715">B</text>
      <text x="365" y="665" font-size="78" font-weight="900" fill="#241715">C</text>
      <text x="1120" y="1086" font-size="78" font-weight="900" fill="#241715">C</text>
    </g>
  `;
}

function slalomBootSvg() {
  return `
    <g transform="translate(-20,80)" filter="url(#softShadow)">
      <path d="M185 1082 C330 1168 792 1268 1088 1222 C1168 1210 1208 1173 1184 1136 C990 1160 728 1118 454 1052 C310 1018 220 1030 185 1082 Z" fill="#1f1b1b" opacity="0.72"/>
      <path d="M190 952 C178 782 220 624 330 520 C466 392 648 424 750 554 C836 663 872 772 1034 862 C1116 907 1192 952 1222 1012 C1228 1070 1195 1118 1135 1142 C883 1215 518 1154 242 1010 C208 992 192 972 190 952 Z" fill="${zoneFill("A")}" stroke="#241715" stroke-width="5"/>
      <path d="M312 520 C410 440 602 426 720 552 C646 574 534 650 462 735 C376 833 296 930 236 1030 C208 840 218 654 312 520 Z" fill="${zoneFill("B")}" stroke="#241715" stroke-width="5"/>
      <path d="M252 642 C444 610 595 653 735 748 L700 823 C520 772 365 773 211 818 Z" fill="${zoneFill("B")}" stroke="#241715" stroke-width="5"/>
      <path d="M214 858 C445 833 662 847 865 908 L835 995 C612 945 410 948 210 988 Z" fill="${zoneFill("A")}" stroke="#241715" stroke-width="5"/>
      <path d="M648 802 L834 868 L720 1002 C682 952 656 886 648 802 Z" fill="#fffdf9" stroke="#241715" stroke-width="4"/>
      <path d="M904 895 C1050 930 1162 970 1222 1012 C1202 1090 1146 1128 1052 1138 C1028 1035 982 956 904 895 Z" fill="${zoneFill("B")}" stroke="#241715" stroke-width="5"/>
      <path d="M270 1002 C325 1030 382 1052 438 1068" fill="none" stroke="#241715" stroke-width="3"/>
      <path d="M448 785 C512 895 574 995 646 1090" fill="none" stroke="#241715" stroke-width="3"/>
      <path d="M778 958 C828 1040 895 1112 982 1175" fill="none" stroke="#241715" stroke-width="3"/>
      <g fill="#fffdf9" stroke="#241715" stroke-width="4">
        <circle cx="812" cy="910" r="20"/>
        <circle cx="890" cy="934" r="19"/>
        <circle cx="968" cy="958" r="18"/>
        <circle cx="1046" cy="982" r="17"/>
      </g>
      <path d="M285 922 L414 1034 L360 1078 L235 958 Z" fill="#241715" opacity="0.9"/>
      <path d="M294 942 L460 1055" stroke="#241715" stroke-width="20" stroke-linecap="round"/>
      <text x="650" y="878" transform="rotate(-30 650 878)" font-size="66" font-weight="900" fill="#241715" opacity="0.65">LOGO</text>
      <text x="690" y="1115" font-size="78" font-weight="900" fill="#241715">A</text>
      <text x="516" y="736" font-size="78" font-weight="900" fill="#241715">B</text>
      <text x="374" y="918" font-size="78" font-weight="900" fill="#241715">A</text>
    </g>
  `;
}

function zoneFill(zone) {
  const data = state.zones[zone];
  if (isBlankZoneState(data)) {
    return "transparent";
  }
  const material = zoneMaterialData(data);
  return material?.image ? `url(#${materialPatternId(zone)})` : material?.color || "transparent";
}

function bootZoneFill(zone) {
  return zoneFill(zone);
}

function materialPatternId(zone) {
  return `material-pattern-${zone}`;
}

function materialImageHref(path) {
  return new URL(path, window.location.href).href;
}

function isValidHexColor(value) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim());
}

function normalizeColor(color) {
  return String(color || "").trim().toLowerCase();
}

async function exportPng() {
  const dataUrl = await sheetSvgToPng();
  downloadDataUrl(dataUrl, `${fileBaseName()}.png`);
}

async function exportPdf() {
  const dataUrl = await sheetSvgToPng();
  if (window.jspdf && window.jspdf.jsPDF) {
    const pdf = new window.jspdf.jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, 297, 210);
    pdf.save(`${fileBaseName()}.pdf`);
    return;
  }
  window.print();
}

async function sheetSvgToPng() {
  const exportSvg = await inlineSvgImages(currentSheetSvg);
  return svgStringToPng(exportSvg);
}

async function inlineSvgImages(svg) {
  const urls = new Set([sheetImageHref()]);
  activeZones().forEach((zone) => {
    const material = zoneMaterialData(state.zones[zone]);
    if (material?.image) {
      urls.add(materialImageHref(material.image));
    }
  });
  activeZones().forEach((zone) => urls.add(maskImageHref(state.model, zone)));
  if (state.model === "speed") {
    urls.add(fixedOverlayHref("strap"));
  }
  if (state.model === "slalom") {
    urls.add(slalomFixedRimMaskHref());
    urls.add(slalomAHeelCorrectionMaskHref());
  }

  const replacements = await Promise.all(
    [...urls].map(async (url) => [escapeAttr(url), await fetchImageDataUrl(url)]),
  );

  return replacements.reduce(
    (result, [url, dataUrl]) => result.split(url).join(dataUrl),
    svg,
  );
}

async function fetchImageDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("無法載入匯出圖片資源");
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("無法轉換匯出圖片資源"));
    reader.readAsDataURL(blob);
  });
}

function svgStringToPng(svg) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 1.5;
      canvas.width = SHEET_WIDTH * scale;
      canvas.height = SHEET_HEIGHT * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fffdf9";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法產生匯出圖片"));
    };
    image.src = url;
  });
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function fileBaseName() {
  const modelName = state.model === "speed" ? "競速鞋" : "速樁鞋";
  const athlete = state.fields.athlete || state.fields.orderNo || "未命名";
  return `STORM_${modelName}_${athlete}`.replace(/[\\/:*?"<>|]/g, "-");
}

function buildShareParams() {
  const params = new URLSearchParams();
  params.set("model", state.model);

  activeZones().forEach((zone) => {
    const value = shareableZoneValue(state.zones[zone]);
    if (value && !isDefaultZoneForShare(zone, state.model)) {
      params.set(zone.toLowerCase(), value);
    }
  });

  formFieldKeys.forEach((field) => {
    const value = state.fields[field];
    if (!isDefaultFieldForShare(field, value, state.model)) {
      params.set(field, String(value));
    }
  });

  return params;
}

function shareableZoneValue(zoneState) {
  if (!zoneState) {
    return "";
  }

  if (zoneState.number !== null && zoneState.number !== undefined) {
    return materialCode(zoneState.number);
  }

  if (zoneState.color) {
    return zoneState.color.replace("#", "");
  }

  return "";
}

function shareUrl() {
  const baseUrl = window.location.href.split("?")[0].split("#")[0];
  const query = buildShareParams().toString();
  const hash = window.location.hash || "";
  return query ? `${baseUrl}?${query}${hash}` : `${baseUrl}${hash}`;
}

function updateShareUrlFromState() {
  window.history.replaceState({}, "", shareUrl());
}

function copyShareUrl() {
  const url = shareUrl();
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    window.prompt("複製分享連結", url);
    return;
  }

  navigator.clipboard.writeText(url).catch(() => {
    window.prompt("複製分享連結", url);
  });
}

function fitText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

init();
