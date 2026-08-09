# UEFN Entitlement Manager

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E)
![Verse](https://img.shields.io/badge/Verse-UEFN%2039+-blue?style=for-the-badge)
![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=for-the-badge)

**A visual In-Island Transactions & Verse Generator for Fortnite UEFN Creators by ADEPT Interactive.**

[Features](#features) • [Installation](#installation) • [Quick Start](#quick-start) • [Verse Integration Guide](#verse-integration-guide) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## 🌟 Overview

The **UEFN Entitlement Manager** provides Fortnite / UEFN developers with a visual interface for constructing, managing, and maintaining In-Island Transactions (IIT) and player entitlements in their projects.

It generates clean, modular, and fully compliant Verse code directly inside your project's `Content/` folder—managing prices, metadata, durable vs. consumable mechanics, moderation compliance (`PaidRandomItem`, `PaidArea`, `ConsequentialToGameplay`), purchase cancellation detection, trigger hooks, player reconnection validation, and direct PNG image to `.uasset` texture upload.

---

## ✨ Key Features

### 🛍️ Visual Entitlement & Offer Modeler
- **Durable vs. Consumable Items**: Configure permanent items (VIP passes, multipliers) vs repeatable consumable boosts with custom max stacks and auto-consumption upon grant.
- **50 V-Buck Validation Engine**: Real-time validation ensuring all prices comply with Fortnite requirements (50 to 5,000 V-Bucks in exact increments of 50).
- **Compliance & Moderation Flags**:
  - `PaidRandomItem` with mandatory odds disclosure metadata.
  - `PaidArea` for paywalls and VIP zones.
  - `ConsequentialToGameplay` for competitive gameplay stats.
  - Optional `GetMinPurchaseAge` for regional and age gating.

### 🖼️ Direct PNG to UEFN Texture Import Pipeline
- **Drag-and-Drop Image Uploader**: Drop PNG icons directly into the tool.
- **Dedicated Public Asset Folder**: Automatically saves assets to `Content/EntitlementIcons/` (customizable) to avoid folder collisions in developer projects and prevent Verse access errors.
- **Automated UEFN Python Importer**: Converts PNGs into native `.uasset` Texture2D files and generates the corresponding Verse texture reference (`EntitlementIcons.<ItemName>`).

### 🎮 Interactive Storefront Sandbox (Simulator)
- Test player purchase flows before deploying to UEFN.
- Test cancellation detection when players close purchase dialogs.
- Simulate player re-joining to verify durable item restoration (`ValidatePreviousPurchases`).
- Real-time terminal log inspecting every Verse event fired.

### ⚡ Clean & Production-Grade Verse Generator
Generates modular Verse code matching Epic Games' latest UEFN 39+ standard:
1. `EntitlementInfo`: Localized message definitions (`<localizes>:message`).
2. `Entitlements`: Concrete entitlement classes inheriting from `basic_entitlement`.
3. `TransactionPrices`: Constants in float/price_dimension.
4. `Offers`: `entitlement_offer` and `bundle_offer` definitions.
5. `in_island_transactions`: Creative device handling player join/leave subscriptions, authoritative `GetEntitlementsChangedEvent`, cancellation hooks, consumption handlers, and trigger bindings.

---

## 🚀 Installation & Quick Start

### Prerequisites
- Node.js 18+ and npm
- (Optional) UEFN active session with Verse Workflow Server enabled on port 1962

### Clone & Install
```bash
# Clone the repository
git clone https://github.com/ADEPT-Interactive/uefn-entitlement-manager.git

# Navigate into the project folder
cd uefn-entitlement-manager

# Install dependencies
npm install
```

### Launch Application
```bash
# Run both the local file IO bridge and the frontend Vite UI
npm start
```
Open your browser at `http://localhost:5173`.

---

## 📖 Verse Integration Guide

### 1. Configure Your Content Directory
In the Entitlement Manager, click the **Settings** gear icon and set your project's `Content/` path (e.g. `C:\Users\<Name>\Documents\UEFN Projects\<Project>\Content`).

### 2. Add or Edit Entitlements
Use the **Add Entitlement** modal to define your items, upload PNG icons, and configure price and lifecycle hooks.

### 3. Save to Project
Click **Save Verse** in the header. The manager will write `in_island_transactions.verse` directly into your `Content/` folder (with automatic `.bak` backups).

### 4. Place Device in UEFN
1. In UEFN, open Verse Explorer and compile code (`Verse > Build Verse Code` or click **Compile Verse** in the web app).
2. Drag the generated `in_island_transactions` creative device into your island.
3. Hook up any `@editable` Button devices or Mutator Zones in the Details panel.

---

## 📂 Architecture

```
O:\UEFN Transaction Entitlement Manager
├── server/
│   ├── index.ts               # Local Express bridge for disk IO & Verse socket
│   └── textureImporter.ts     # PNG to Content/ folder & UAsset import generator
├── src/
│   ├── components/
│   │   ├── Header.tsx         # Navigation, workspace bar, sync status
│   │   ├── EntitlementList.tsx# Grid/list catalog with stats & filters
│   │   ├── EntitlementCard.tsx# Interactive card with badges & test buy
│   │   ├── EntitlementModal.tsx # Full-featured creation & editing modal
│   │   ├── ImageUploadZone.tsx# Drag-and-drop PNG uploader
│   │   ├── VersePreview.tsx   # Syntax-highlighted Verse code viewer
│   │   ├── SimulatorModal.tsx # Interactive Fortnite storefront sandbox
│   │   └── ValidationReportModal.tsx # Moderation compliance checker
│   ├── services/
│   │   ├── verseGenerator.ts  # Verse code generation engine
│   │   ├── verseParser.ts     # Bi-directional Verse parser
│   │   ├── validator.ts       # UEFN compliance validation engine
│   │   └── fileService.ts     # File IO & API client
│   └── types/
│       └── entitlement.ts     # TypeScript data models
```

---

## 🤝 Contributing

Contributions are welcome! If you have suggestions for new UEFN transaction features, feel free to open an Issue or submit a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

Built with ❤️ by **ADEPT Interactive** for the Fortnite Creative & UEFN Developer Community.
