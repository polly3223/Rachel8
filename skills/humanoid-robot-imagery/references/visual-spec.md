# Robot Visual Specification

Create one project-level `robot-visual-spec.yaml` from this schema. Replace descriptive guesses with measured values after approving the golden image.

```yaml
version: 1
status: draft
golden:
  robot_slug: ""
  image: ""
canvas:
  aspect_ratio: "4:5"
  width: 1536
  height: 1920
  color_space: "sRGB"
composition:
  yaw_degrees: 0
  stance: "upright, balanced, feet shoulder-width"
  arms: "relaxed naturally beside torso"
  head: "level, looking forward"
  subject_height_percent: 82
  top_margin_percent: 8
  floor_line_percent: 91
camera:
  perspective: "restrained studio perspective"
  height: "locked from golden image"
  distance: "locked from golden image"
lighting:
  key: "large soft source, upper front-left"
  fill: "soft neutral fill"
  rim: "subtle separation only"
  contact_shadow: "soft, compact, neutral"
background:
  type: "smooth editorial gradient"
  direction_degrees: 135
  stops:
    - position: 0
      color: "#E8F0F2"
    - position: 1
      color: "#A9C1C7"
  texture: "none"
render:
  style: "realistic editorial product photography"
  sharpness: "high product detail, natural edges"
  grain: "none"
forbidden:
  - props
  - scenery
  - people
  - text
  - decorative platforms
  - dramatic poses
  - invented components
  - cropped feet or head
```

The values above are starting defaults, not a permanent art direction. Once the first image is approved:

1. Record the exact golden file.
2. Replace qualitative fields with precise descriptions derived from it.
3. Freeze the version.
4. Increment `version` for any composition-level change.

Robot-specific colors, materials, markings, geometry, and proportions never belong in this shared file. They come from each robot's approved references.
