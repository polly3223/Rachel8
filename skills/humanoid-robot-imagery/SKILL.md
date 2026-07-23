---
name: humanoid-robot-imagery
description: Generate a consistent editorial series of full-body humanoid robot images from approved reference photos. Use for Robot Media comparison cards, profiles, covers, and datasets when robots must share one standing pose, camera, crop, lighting, scale, and gradient backdrop while preserving each model's real geometry and materials. Also use when reviewing or regenerating an existing robot-series asset for reference fidelity or visual consistency.
---

# Humanoid Robot Imagery

Create reference-led editorial renders, not imaginative robot concepts. Preserve product identity while enforcing one visual system across the series.

Use the built-in `image_gen` tool. Follow the installed `imagegen` skill for tool and save-path rules.

## Required Inputs

Before generating a new robot, locate:

- The robot slug and exact manufacturer/model.
- Two to five approved reference images when available.
- The project's `robot-visual-spec.yaml`.
- The approved golden image from the same series, if one exists.
- The final output directory and required aspect ratio/resolution.

Do not proceed from weak references when factual product fidelity matters. Ask for better references or clearly label the result as provisional.

Assign reference roles:

- **Shape anchor:** clearest full-body view for proportions and silhouette.
- **Detail anchors:** close or alternate views for joints, hands, head, feet, panels, and materials.
- **Golden style anchor:** approved series image; use only for pose, camera, lighting, crop, and backdrop.

Inspect every local reference before generation. Do not treat a promotional render as proof of unseen geometry.

## First Series Image

If no golden image or visual spec exists:

1. Select the strongest robot reference set.
2. Copy `references/visual-spec.md` into a concrete `robot-visual-spec.yaml`.
3. Generate one canonical image only.
4. Compare it against the references and record corrections.
5. Iterate with one targeted correction per pass.
6. Stop and request editorial approval.
7. Mark the approved result as the golden image and lock its measured visual choices in the spec.

Do not generate the full series before the golden image is approved.

## Generate A Robot

1. Read the visual spec and inspect the golden image.
2. Inspect all product references and write a short identity checklist:
   - body proportions and silhouette
   - head/sensor arrangement
   - torso and pelvis shell geometry
   - arms, hands, legs, joints, and feet
   - dominant materials, colors, seams, and visible branding
3. Build a structured prompt using the locked prompt below.
4. Pass every local reference path to image generation. Identify each image's role in the prompt.
5. Generate one candidate at a time.
6. Inspect the output at full resolution.
7. Score it using the acceptance checks.
8. If needed, regenerate with one explicit correction while restating all locked invariants.
9. Save non-destructively under the robot slug. Keep only editorially useful candidates.
10. Record the final prompt, reference filenames, model/tool path, and status beside the asset.

## Locked Prompt

Adapt only bracketed fields:

```text
Use case: product-mockup
Asset type: standardized editorial humanoid robot profile

Primary request:
Create a faithful full-body studio image of [MANUFACTURER MODEL], using the supplied product photographs as the sole authority for the robot's design. Reproduce its recognizable proportions, shell geometry, sensor/head arrangement, joints, hands, feet, materials, colors, seams, and visible markings. Do not redesign, beautify, simplify, or hybridize it.

Reference roles:
- [IMAGE]: shape anchor for product identity and proportions
- [IMAGE(S)]: detail anchors for product-specific construction
- [GOLDEN IMAGE]: style anchor only for pose, camera, crop, lighting, and backdrop; do not copy that robot's anatomy

Locked series composition:
- One robot only, standing naturally upright
- Front-facing [or exact locked yaw], head level
- Arms relaxed in the exact locked position
- Feet in the exact locked stance, fully visible
- Exact locked camera height, perspective, subject scale, margins, and floor line
- Exact locked soft studio lighting and shadow behavior
- Exact locked [COLORS] gradient backdrop
- Clean editorial product photography, realistic materials

Product-specific fidelity:
[IDENTITY CHECKLIST]

Invariants:
No props, scenery, people, text, captions, decorative platform, dramatic action pose, added LEDs, invented panels, altered limb count, cropped extremities, watermark, or anatomy borrowed from the golden robot.
```

## Acceptance Checks

Reject or regenerate when any critical check fails:

- **Identity:** A knowledgeable reader can identify the correct robot without the caption.
- **Geometry:** Head, torso, pelvis, limb proportions, joints, hands, and feet agree with references.
- **No hallucination:** No invented components or cross-contamination from another robot.
- **Pose:** Key body landmarks align with the golden image.
- **Framing:** Robot scale, camera angle, margins, feet, and floor line match the series.
- **Backdrop:** Gradient direction, stops, brightness, and contrast match the spec.
- **Lighting:** Highlight direction, material response, and contact shadow are consistent.
- **Editorial safety:** No misleading performance scene or unsupported visual claim.

Use side-by-side inspection rather than judging from memory. For uncertain details, prefer omission only when the detail is genuinely hidden in the references; never invent it.

## Files And Handoff

Use the project's established asset structure. If none exists, use:

```text
src/assets/robots/<slug>/
  references/
  candidates/
  final/
  generation.yaml
```

The content slug and asset slug must match. `generation.yaml` should include:

- `robot`
- `status`: `provisional`, `review`, or `approved`
- `golden_spec_version`
- `references`
- `prompt`
- `tool`
- `created_at`
- `notes`

Never overwrite an approved final. Create a versioned candidate and replace the content reference only after approval.

## Updating The Series

Changing pose, camera, gradient, lighting, crop, or output ratio creates a new visual-spec version. Do not silently mix versions in one comparison view. Regenerate the golden image first, approve it, then migrate other robots deliberately.

Read `references/visual-spec.md` when creating or revising the project lockfile.
