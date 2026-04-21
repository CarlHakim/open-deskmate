---
name: OpenDeskMate Design System
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#414754'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#727785'
  outline-variant: '#c2c6d6'
  surface-tint: '#005ac2'
  primary: '#0058bd'
  on-primary: '#ffffff'
  primary-container: '#1470e8'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#7726e0'
  on-secondary: '#ffffff'
  secondary-container: '#9149fa'
  on-secondary-container: '#fffbff'
  tertiary: '#00694d'
  on-tertiary: '#ffffff'
  tertiary-container: '#008562'
  on-tertiary-container: '#f5fff8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004494'
  secondary-fixed: '#ecdcff'
  secondary-fixed-dim: '#d5baff'
  on-secondary-fixed: '#270057'
  on-secondary-fixed-variant: '#5f00c0'
  tertiary-fixed: '#54fdc4'
  tertiary-fixed-dim: '#27e0a9'
  on-tertiary-fixed: '#002116'
  on-tertiary-fixed-variant: '#00513b'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  h1:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  h2:
    fontFamily: Manrope
    fontSize: 36px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  h3:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 40px
  xl: 64px
  container-max: 1280px
  gutter: 24px
---

## Brand & Style

This design system is built to evoke the feeling of a highly capable, always-available digital colleague. The brand personality is **Intelligent, Collaborative, and Empathetic**. It balances the precision of high-end engineering with the approachability of a personal assistant.

The visual style is a hybrid of **Modern Corporate** and **Soft Glassmorphism**. It utilizes semi-transparent surfaces and blurred backgrounds to suggest depth and high-tech "AI-native" processing, while maintaining a structured grid that ensures the user feels in control. The goal is to move away from cold, robotic interfaces toward a "human-in-the-loop" aesthetic that feels helpful rather than overwhelming.

## Colors

The color palette is directly derived from the vibrant energy of the brand logo. 
- **Primary Blue:** Used for core actions, focus states, and primary branding elements. It represents stability and technology.
- **Secondary Purple:** Used for "AI-driven" moments, such as agent suggestions, thought processes, and magical UI transitions.
- **Tertiary Teal:** Employed for success states, active status indicators, and positive feedback loops.
- **Accent Yellow:** Reserved for high-priority notifications or "sticky note" highlights, providing a warm, human touch to the interface.

The system defaults to a **Light Mode** with high-clarity white backgrounds and cool-gray neutrals to ensure the vibrant brand colors remain the focal point without causing visual fatigue.

## Typography

This design system employs a dual-font strategy to balance character with utility. 

**Manrope** is used for headings. Its geometric yet slightly condensed proportions provide a tech-forward and authoritative look while remaining friendly. It excels at large scales where its unique character shines.

**Inter** is the workhorse for body copy and UI labels. It was chosen for its exceptional legibility at small sizes and its neutral, systematic feel. It ensures that complex data and long AI-generated explanations remain easy to parse.

To maintain clarity, the system uses generous line heights and subtle negative letter-spacing for large headlines to keep them punchy.

## Layout & Spacing

The layout is based on a **Fluid Grid** system with a focus on generous white space to reduce cognitive load. 

A strict **8px linear scale** governs all spacing decisions, ensuring mathematical harmony across the interface. Standard page layouts should utilize a 12-column grid for desktop views, with 24px gutters. Elements should be grouped into logical "clusters" using smaller increments (4px, 12px) to signify relationship, while larger sections are separated by 40px or 64px to denote a change in context.

Margins should be wide to push content into a comfortable central reading area, particularly for chat-based interactions or agent configuration screens.

## Elevation & Depth

Depth in this design system is created through **Ambient Shadows** and **Tonal Layering**. 

Unlike traditional flat design, elements here exist on different planes. Backgrounds are the lowest layer. Surface containers (cards, sidebars) sit slightly above the background with a soft, diffused shadow (`0px 4px 20px rgba(58, 134, 255, 0.08)`). Notice the slight blue tint in the shadow—this keeps the shadows "airy" and integrated with the brand colors.

For AI-specific interactions, such as floating agent widgets or tooltips, use **Glassmorphism**: a background blur of 12px combined with a 60% white fill and a subtle 1px border. This creates a "heads-up display" effect that feels modern and lightweight.

## Shapes

The shape language is defined by **Rounded** geometry. Sharp corners are avoided to maintain the "mate" (friendly/helpful) aspect of the brand.

- **Standard Elements (Buttons, Inputs):** 0.5rem (8px) radius.
- **Large Elements (Cards, Modals):** 1rem (16px) radius.
- **Ultra-Soft Elements (Avatars, Tags):** 1.5rem (24px) or full pill-shape.

This consistency in curvature mirrors the circular nature of the logo's robot head and the curved mug handle, creating a cohesive visual loop throughout the product experience.

## Components

### Buttons
Primary buttons use a subtle vertical gradient from the Primary Blue to a slightly deeper shade. They feature a soft glow on hover. Secondary buttons use a ghost style with a Primary Blue border and a 5% blue tint on hover.

### Cards
Cards are the primary container. They should have a 1px border (`#E2E8F0`), a 16px corner radius, and the standard ambient shadow. For "active" AI agent cards, the border can transition to a Primary Blue or Secondary Purple gradient.

### Input Fields
Inputs should be clean with a 1px border. On focus, the border color changes to Primary Blue and gains a subtle outer glow (3px spread). The label should always be visible (top-aligned) to ensure accessibility.

### AI "Pulse" Indicators
A custom component for this design system: a small, pulsing glow effect used next to active agents. It uses the Tertiary Teal for "ready" and Secondary Purple for "processing."

### Chips & Tags
Used for agent capabilities or status. These are full-pill shapes with low-opacity backgrounds (10-15%) of their respective functional color (e.g., a purple background for a "Creative" tag).

### Chat Bubbles
User messages are Primary Blue with white text. Agent messages are white with a subtle border and the glassmorphic blur effect to distinguish "machine-generated" content from "user-generated" content.