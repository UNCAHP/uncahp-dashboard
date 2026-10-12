# UNCAHP Launch OS - Design System & Styling Spec

This document outlines the core styling specifications, color palette, typography, and reusable component classes for the UNCAHP Launch OS application. The UI adheres to a sleek, modern, "glassmorphic" dark theme.

## 1. Color Palette

The application uses CSS variables defined in `/src/index.css` for consistent theming.

### Backgrounds
- **App Background:** `#0f1014` (`var(--bg-app)`) - The main lowest-layer background.
- **Card Background:** `#141519` (`var(--bg-card)`) - Used for elevated containers and panels.
- **Surface:** `#18191d` (`var(--bg-surface)`) - Used for inputs, dropdowns, and nested elements.
- **Surface Hover:** `#222329` (`var(--bg-surface-hover)`) - Interactive states for surface elements.

### Brand Colors
- **Primary:** `#f472d0` (`var(--primary)`) - The primary signature pink gradient color used for buttons and accents.
- **Primary Hover:** `#e060b0` (`var(--primary-hover)`)
- **Secondary:** `#8b5cf6` (`var(--secondary)`) - A complementary purple used for gradients and subtle accents.

### Text Colors
- **Main Text:** `#ffffff` (`var(--text-main)`) - High contrast text for headings and primary content.
- **Muted Text:** `#9ca3af` (`var(--text-muted)`) - Secondary text, labels, and descriptions.
- **Dim Text:** `#6b7280` (`var(--text-dim)`) - Tertiary text and subtle disabled states.

### Status Indicators
- **Success:** `#10b981` (`var(--success)`)
- **Warning:** `#f59e0b` (`var(--warning)`)
- **Error:** `#ef4444` (`var(--error)`)
- **Info:** `#3b82f6` (`var(--info)`)

### Borders & Dividers
- **Border:** `#2e2f36` (`var(--border)`) - Used for card outlines and structural boundaries.
- **Divider:** `#1f2937` (`var(--divider)`) - Used for subtle list separators.

---

## 2. Typography

The default font across the application is **Space Grotesk**, a modern geometric sans-serif typeface.

- **Font Family:** `'Space Grotesk', system-ui, sans-serif` (`var(--font-sans)`)
- **Base Text Sizes (Tailwind Utility Classes):**
  - Text SM (`text-sm`): `0.875rem`
  - Text XS (`text-xs`): `0.75rem`
- **Font Weights:** Medium (`500`), Semi-bold (`600`), Bold (`700`) are predominantly used for contrast.

---

## 3. Structural Properties

### Border Radii
- **Small (`sm`):** `0.375rem` (`var(--radius-sm)`)
- **Medium (`md`):** `0.5rem` (`var(--radius-md)`)
- **Large (`lg`):** `0.75rem` (`var(--radius-lg)`) - Used widely for cards and main containers.
- **Extra Large (`xl`):** `1rem` (`var(--radius-xl)`)

---

## 4. Reusable Custom CSS Classes

Instead of relying purely on Tailwind utilities, `index.css` provides abstracted classes for frequent UI patterns:

### Buttons
- `.btn`: The base structure for interactive buttons. Includes transitions, sizing, and typography.
- `.btn-primary`: Vibrant, glowing gradient button intended for primary call-to-actions. Includes a pink/magenta `box-shadow` that intensifies on hover.
- `.btn-glass`: A semi-transparent glassmorphic button with backdrop blur. Useful for secondary actions that shouldn't grab full attention.

### Containers
- `.card`: A standard container with `bg-card`, border styling, and large border-radius.
- `.label`: A small, uppercase, bolded, and muted label style used predominantly for form inputs.

### Badges
- `.badge`: Base pill-shaped badge styling (small uppercase font, rounded).
- `.badge-success`, `.badge-warning`, `.badge-planned`: State-specific badges applying a semi-transparent background mapped to the core status colors.

### Forms
- `input`, `textarea`, `select`: Globally styled to use the `bg-surface` color with subtle borders that transition to the `primary` color on focus.

---

## 5. Animations & Effects

Launch OS uses subtle but premium keyframe animations to give life to the interface:

- **`.stage-active-glow` / `premium-pulse`:** A pulsating gradient shadow (`box-shadow: 0 0 20px 5px rgba(244, 140, 207, 0.5)`) used to highlight active components or currently active stages in a launch pipeline.
- **Aurora Backgrounds:** A series of keyframes (`aurora-float-1`, `aurora-float-2`, `aurora-float-3`) that subtly pan and scale background gradients behind authentication or decorative screens to mimic a glowing, ambient aura.
- **Glassmorphism:** Achieved by combining `bg-[rgba(255,255,255,0.03)]` and `backdrop-filter: blur(x)` across various widgets and modals.
