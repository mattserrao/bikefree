// Public entry point for kit authors. These additions do not change scene defaults.
export { TEXTURE_CATALOG, TEXTURE_RECIPES, TEXTURE_FAMILIES, findTextures, getTexture } from './texture-catalog.js';
export { makeCatalogMaterial, catalogMaterialSpec } from './catalog-material.js';
export { SURFACE_LIBRARY, makeToolboxSurface, toolboxSurfaceSpec } from './surface-library.js';
export { ROAD_TEXTURES, ROAD_TEXTURE_CONTROLS } from './road-textures.js';
export { SURFACES, decorateRoad } from './road-surface.js';
