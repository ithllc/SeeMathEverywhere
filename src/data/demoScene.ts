import demoSkylinePhoto from '../assets/images/manhattan_skyline_night_1794713477564.jpg';
import type { SceneAnalysisResponse } from '../types/concepts.ts';

export const DEMO_SCENE_IMAGE_URL: string = demoSkylinePhoto;

// Self-contained SVG fallback scene in case image loading is interrupted offline
export const DEMO_FALLBACK_SVG_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#050914"/>
      <stop offset="55%" stop-color="#0B162C"/>
      <stop offset="100%" stop-color="#091122"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B1528"/>
      <stop offset="100%" stop-color="#040710"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="500" fill="url(#sky)"/>
  <rect y="500" width="1200" height="400" fill="url(#water)"/>
  <rect x="190" y="290" width="38" height="210" fill="#1E293B"/>
  <rect x="330" y="325" width="68" height="175" fill="#1E293B"/>
  <rect x="840" y="160" width="58" height="340" fill="#334155"/>
  <rect x="805" y="300" width="68" height="200" fill="#475569"/>
  <polygon points="0,750 320,520 320,560 0,830" fill="#0F172A"/>
  <rect x="560" y="510" width="180" height="34" rx="8" fill="#E2E8F0"/>
  <rect x="635" y="560" width="26" height="260" fill="#FDE68A" opacity="0.35"/>
  <rect x="835" y="540" width="44" height="310" fill="#F59E0B" opacity="0.32"/>
</svg>`);

export const GUIDED_DEMO_RESPONSE: SceneAnalysisResponse = {
  isDemo: true,
  sceneSummary:
    'Nighttime view across the Hudson River from the New Jersey waterfront toward the illuminated Manhattan skyline, with a commuter ferry crossing the water and shimmering vertical light columns.',
  concepts: [
    {
      id: 'water-reflection',
      category: 'Physics',
      title: 'Law of Reflection & Surface Scattering',
      equation: 'θᵢ = θᵣ',
      plainExplanation:
        'Light reaches the water and reflects at the same angle relative to the local surface. Gentle river ripples tilt thousands of tiny water facets, stretching tower lights into vertical columns.',
      visibleEvidence:
        'Golden and white light streaks extending vertically down the Hudson River directly beneath One World Trade Center and the illuminated ferry.',
      whyItMatters:
        'Engineers apply specular and surface reflection models in marine radar, fiber-optic cables, telescope mirrors, and realistic ocean rendering in computer graphics.',
      confidence: 0.96,
      measurementType: 'qualitative',
      overlay: {
        type: 'angle',
        points: [
          { x: 0.725, y: 0.27, label: 'Skyscraper light' },
          { x: 0.715, y: 0.69, label: 'Water facet (θᵢ = θᵣ)' },
          { x: 0.34, y: 0.86, label: 'Observer eye' },
        ],
      },
      levelExplanations: {
        elementary:
          'Light from the bright tall buildings bounces off the river water like a ball bouncing off the floor. Tiny waves tip the water so the reflection stretches into a long glowing stripe.',
        middle:
          'When light hits a smooth patch of water, its incoming angle equals its outgoing bounce angle (θᵢ = θᵣ). Ripples tilt tiny mirrors of water at different slopes, stacking reflections into vertical columns.',
        high:
          'Light reaches the water and reflects at the same angle relative to each ripple’s local normal vector (θᵢ = θᵣ). Because wind-driven waves pitch mostly toward and away from you, specular highlights spread vertically across the river.',
        college:
          'Specular reflection obeys θᵢ = θᵣ relative to each capillary wave facet normal, governed by Fresnel reflectance at grazing viewing angles. Integrating tilted surface normals along the line of sight produces an elongated glitter path.',
      },
    },
    {
      id: 'perspective-similar-triangles',
      category: 'Math',
      title: 'Perspective & Similar Triangles',
      equation: 'h₁ / d₁ = h₂ / d₂',
      plainExplanation:
        'Objects occupy less of the camera image as their distance increases. Foreground pier railings and distant skyscrapers form proportional right triangles converging toward the camera lens.',
      visibleEvidence:
        'The wooden pier walkway on the left converges sharply toward the horizon, making nearby railing posts appear nearly as tall on screen as skyscrapers miles across the river.',
      whyItMatters:
        'Used every day in architectural rendering, land surveying, autonomous-vehicle monocular depth estimation, and photogrammetry.',
      confidence: 0.94,
      measurementType: 'qualitative',
      overlay: {
        type: 'triangle',
        points: [
          { x: 0.04, y: 0.79, label: 'Near railing h₁' },
          { x: 0.265, y: 0.56, label: 'Vanishing point' },
          { x: 0.04, y: 0.56, label: 'Horizon line' },
        ],
      },
      levelExplanations: {
        elementary:
          'Close things look big and faraway things look small, even when a skyscraper is giant! Your camera sees matching triangle shapes that shrink smoothly with distance.',
        middle:
          'An object’s apparent size in a photo depends on the ratio of its real height to its distance (h/d). That is why a short pier fence right next to you can look as tall on screen as a distant tower.',
        high:
          'Pinhole camera projection creates similar triangles between real-world height/distance (h/d) and sensor image height/focal length. Parallel pier rails converge toward a single vanishing point on the horizon.',
        college:
          'Under rectilinear perspective projection, image plane height y′ = f · (h / d) follows directly from triangle similarity in projective space, mapping parallel 3D world lines to intersections at the horizon line.',
      },
    },
    {
      id: 'ferry-velocity',
      category: 'Physics',
      title: 'Velocity Across the River',
      equation: 'v = Δx / Δt',
      plainExplanation:
        'Tracking a boat’s position over time gives an estimate of its velocity. Both speed and heading matter as the ferry compensates for river currents between piers.',
      visibleEvidence:
        'The lit commuter ferry mid-river moving left across the water while leaving a trailing surface wake behind its stern.',
      whyItMatters:
        'Essential for maritime GPS navigation, harbor traffic control, aviation wind-crabbing calculations, and mobile robotics.',
      confidence: 0.91,
      measurementType: 'estimated',
      overlay: {
        type: 'vector',
        points: [
          { x: 0.64, y: 0.59, label: 'Wake origin x₁' },
          { x: 0.46, y: 0.59, label: 'Velocity v (est.)' },
        ],
      },
      levelExplanations: {
        elementary:
          'Velocity tells us how fast the ferry boat is moving and which direction it is headed across the river. Watching how far it travels in a few seconds lets you estimate its speed.',
        middle:
          'Velocity equals change in position divided by elapsed time (v = Δx / Δt) in a specific direction. Comparing the boat’s hull length and wake over time gives a visual estimate of speed.',
        high:
          'Tracking the ferry’s displacement vector Δx over a time interval Δt yields an estimate of average velocity v = Δx / Δt. Captains also add river current vectors so the boat arrives at the right slip.',
        college:
          'Average velocity v̄ = Δx / Δt is a vector quantity; in tidal estuaries like the Hudson, vessel ground track is the vector sum of hull velocity through water plus tidal current drift.',
      },
    },
    {
      id: 'window-coordinate-grid',
      category: 'Math',
      title: 'Coordinate Geometry in Window Grids',
      equation: '(x, y) = (x₀ + c·Δx, y₀ + r·Δy)',
      plainExplanation:
        'Illuminated office floors and structural columns form a two-dimensional Cartesian lattice. Every window location can be addressed by its column and floor offsets from a corner origin.',
      visibleEvidence:
        'Uniform horizontal rows and vertical columns of lit office windows across the waterfront tower facade.',
      whyItMatters:
        'Powers structural Curtain-Wall engineering, digital image pixel arrays, spreadsheet addressing, and robotic facade-inspection drones.',
      confidence: 0.93,
      measurementType: 'qualitative',
      overlay: {
        type: 'grid',
        points: [
          { x: 0.672, y: 0.34, label: 'Grid (c, r)' },
          { x: 0.735, y: 0.46, label: 'Origin (x₀, y₀)' },
        ],
      },
      levelExplanations: {
        elementary:
          'Skyscraper windows line up in neat rows and columns just like squares on a checkerboard. Counting across and up lets you name the exact spot of any lit window.',
        middle:
          'Building facades act like giant graph paper where columns are x-steps and floors are y-steps. Starting from one corner, multiplying column and floor numbers by spacing locates every window.',
        high:
          'Repeating architectural bays create a discrete 2D lattice (x₀ + c·Δx, y₀ + r·Δy). Engineers use coordinate grids like this to distribute wind loads and fabricate identical glass panels.',
        college:
          'Regular curtain-wall facades instantiate an affine 2D lattice Z² embedded in 3D space; homography matrices map these coplanar grid intersections onto the camera’s 2D sensor plane.',
      },
    },
  ],
};
