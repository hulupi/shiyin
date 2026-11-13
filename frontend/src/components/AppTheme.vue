<script setup lang="ts">
// Document reset, theme variables and shared Element Plus defaults.
</script>
<template></template>

<style scoped lang="scss">
:global(:root) {
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
  color: #e9edea;
  background: #101311;
  font-synthesis: none;
  font-size: 14px;
  color-scheme: dark;
  --green: #44d17a;
  --border: #252f28;
}

:global(html.light) {
  color-scheme: light;
  color: #203329;
  background: #f5f8f5;
  --green: #23814e;
  --border: #d6e2d8;
  --muted: #53685b;
  --day-text: #203329;
  --day-muted: #53685b;
  --day-accent-text: #216e46;
  --day-danger-text: #a13c35;
  --day-on-accent: #fff;
  --day-accent-hover: #1b6d40;
  --day-player-glass: rgb(248 253 249 / 90%);
  --day-surface: #fff;
  --day-surface-soft: #eff5ef;
  --day-selected: #dcefe1;
  --day-rose: #fae9ef;
  --day-amber: #f8efda;
  --day-line: #d6e2d8;
  --day-scrollbar: #a6bbad;
  --el-color-primary: #23814e;
  --el-color-primary-light-3: #3f9867;
  --el-color-primary-light-5: #80ba98;
  --el-color-primary-light-7: #b6d9c2;
  --el-color-primary-light-8: #d3e9da;
  --el-color-primary-light-9: #e9f5ec;
  --el-color-primary-dark-2: #176a3d;
  --el-bg-color: #fff;
  --el-bg-color-page: #f5f8f5;
  --el-bg-color-overlay: #fff;
  --el-fill-color-blank: #fff;
  --el-fill-color-light: #eff5ef;
  --el-fill-color-dark: #dfeae1;
  --el-text-color-primary: #203329;
  --el-text-color-regular: #3f5648;
  --el-text-color-secondary: #53685b;
  --el-text-color-placeholder: #64796b;
  --el-border-color: #cbdad0;
  --el-border-color-light: #d6e2d8;
  --el-border-color-lighter: #e3ece5;
  --el-font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
  --el-border-radius-base: 7px;
  --song-row-highlight: #e4f1e7;
  --song-row-hover-title: #203329;
  --song-row-hover-text: #3f5648;
  --song-row-radius: 10px;
  --song-row-height: 56px;
  --song-row-gap: 6px;
}

:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
}

:global(button),
:global(input) {
  font: inherit;
}

:global(button) {
  cursor: pointer;
  border: 0;
  color: inherit;
  background: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

:global(button:disabled) {
  opacity: 0.4;
  cursor: default;
}

:global(button:focus-visible),
:global(input:focus-visible) {
  outline: 2px solid var(--green);
  outline-offset: 3px;
}

:global(input) {
  color: inherit;
  border: 1px solid var(--border);
  background: var(--day-surface-soft, #171f19);
  border-radius: 7px;
  padding: 12px 15px;
  min-width: 0;
}

:global(h1),
:global(h2),
:global(p) {
  margin: 0;
}

:global(h1) {
  font-size: 32px;
  letter-spacing: -1px;
  font-weight: 650;
}

:global(h2) {
  font-size: 17px;
  font-weight: 600;
}

:global(p) {
  color: var(--day-muted, #88968d);
  line-height: 1.9;
}

:global(small) {
  font-size: 14px;
}

:global(input[type="range"]) {
  appearance: none;
  height: 3px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    var(--green) var(--fill, 0%),
    var(--day-line, #2b3a30) var(--fill, 0%)
  );
  cursor: pointer;
}

:global(input[type="range"]::-webkit-slider-thumb) {
  appearance: none;
  width: 8px;
  height: 8px;
  background: var(--day-accent-text, #bddfc7);
  border-radius: 50%;
}

:global(input[type="range"]::-moz-range-thumb) {
  border: 0;
  width: 8px;
  height: 8px;
  background: var(--day-accent-text, #bddfc7);
  border-radius: 50%;
}

@media (max-width: 700px) {
  :global(h1) {
    font-size: 25px;
  }
}
:global(html) {
  scrollbar-gutter: auto;
}
:global(:root) {
  --player-height: 108px;
}

:global(html),
:global(body),
:global(#app) {
  height: 100%;
  overflow: hidden;
  scrollbar-gutter: auto;
}

@media (max-width: 700px) {
  :global(:root) {
    --player-height: 118px;
  }
}
:global(:root) {
  --sidebar-width: 224px;
  --player-height: 132px;
}

@media (max-width: 1100px) {
  :global(:root) {
    --sidebar-width: 190px;
  }
}

@media (max-width: 700px) {
  :global(:root) {
    --sidebar-width: 62px;
    --player-height: calc(118px + env(safe-area-inset-bottom, 0px));
  }
}
:global(html.dark) {
  --el-color-primary: #44d17a;
  --el-color-primary-light-3: #65dd92;
  --el-color-primary-light-5: #3b7950;
  --el-color-primary-light-7: #2a5035;
  --el-color-primary-light-8: #213e2a;
  --el-color-primary-light-9: #1a3021;
  --el-color-primary-dark-2: #37b868;
  --el-bg-color: #151e18;
  --el-bg-color-page: #101311;
  --el-bg-color-overlay: #1a241d;
  --el-fill-color-blank: #151e18;
  --el-text-color-primary: #e9edea;
  --el-text-color-regular: #b2c1b7;
  --el-text-color-secondary: #81988a;
  --el-border-color: #344239;
  --el-border-color-light: #29382e;
  --el-border-color-lighter: #253129;
  --el-fill-color-light: #223329;
  --el-font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
  --el-border-radius-base: 7px;
  --song-row-highlight: #293e31;
  --song-row-hover-title: #f0fff4;
  --song-row-hover-text: #d9e9df;
  --song-row-radius: 10px;
  --song-row-height: 56px;
  --song-row-gap: 6px;
}
:global(.el-button) {
  font-family: inherit;
}
:global(.el-button + .el-button) {
  margin-left: 0;
}
:global(.el-button.primary),
:global(.el-button.secondary) {
  height: auto;
  min-height: 36px;
}
:global(.el-button--primary) {
  --el-button-text-color: var(--day-on-accent, #072512);
  --el-button-hover-text-color: var(--day-on-accent, #072512);
}
:global(.el-button > span) {
  gap: 8px;
}
:global(.el-input__inner) {
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 0;
}
:global(.el-input__wrapper),
:global(.el-select__wrapper) {
  min-height: 38px;
}
:global(.el-alert) {
  margin: 12px 0;
}
:global(.el-message-box) {
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 32px);
  display: inline-flex;
  flex-direction: column;
}
:global(.el-message-box__content) {
  min-height: 0;
  overflow-y: auto;
}
:global(.el-message-box__header),
:global(.el-message-box__btns) {
  flex-shrink: 0;
}
:global(.el-message-box__btns) {
  gap: 12px;
  padding-top: 18px;
}
:global(.el-message-box__btns .el-button) {
  min-width: 68px;
  margin: 0;
}
:global(.el-message-box__message) {
  overflow-wrap: anywhere;
}
:global(.music-version-prompt .el-message-box__message) {
  white-space: pre-line;
  max-height: 45vh;
  overflow-y: auto;
}
:global(.el-dropdown-menu__item) {
  gap: 10px;
  min-height: 38px;
}
:global(.el-message) {
  max-width: calc(100vw - 32px);
}
:global(:root) {
  --sidebar-width: 230px;
  --player-height: 96px;
}
@media (max-width: 1100px) {
  :global(:root) {
    --sidebar-width: 190px;
  }
}
@media (max-width: 700px) {
  :global(:root) {
    --sidebar-width: 62px;
  }
}
:global(:root) {
  --player-height: 136px;
  --desktop-player-bar-height: 90px;
  --desktop-player-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

@media (max-width: 700px) {
  :global(:root) {
    --sidebar-width: 0px;
    --mobile-player-bar-height: 76px;
    --player-height: calc(var(--mobile-player-bar-height) + env(safe-area-inset-bottom, 0px));
  }
}

:global(button),
:global(a) {
  -webkit-tap-highlight-color: transparent;
}
:global(.app-shell .platform-tabs) {
  align-items: center;
  align-content: flex-start;
}
:global(.app-shell .platform-tabs > button.el-button) {
  flex: 0 0 auto;
  height: 32px;
  min-height: 32px;
  padding: 0 17px;
  border: 0;
  border-radius: 999px;
  line-height: 1;
  box-shadow: none;
  transition: background-color 0.15s, color 0.15s;
}
:global(.app-shell .platform-tabs > button.el-button:focus:not(:focus-visible)) {
  outline: none;
}
:global(.app-shell .platform-tabs > button.el-button.active) {
  background: var(--green);
  color: var(--day-on-accent, #082e15);
}
@media (max-width: 700px) {
  :global(.app-shell .platform-tabs > button.el-button) {
    height: 28px;
    min-height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }
}
:global(.music-segmented.el-segmented) {
  --el-border-radius-base: 16px;
  --el-segmented-padding: 3px;
  --el-segmented-color: var(--day-muted, #a8bdb0);
  --el-segmented-bg-color: var(--day-surface-soft, #15231a);
  --el-segmented-item-selected-color: var(--day-on-accent, #082e15);
  --el-segmented-item-selected-bg-color: var(--green);
  --el-segmented-item-hover-bg-color: var(--day-selected, #24392c);
  --el-segmented-item-active-bg-color: var(--day-selected, #2d4836);
  min-height: 36px;
}
:global(.music-segmented .el-segmented__item) {
  padding-inline: 14px;
}
@media (prefers-reduced-motion: reduce) {
  :global(.music-segmented .el-segmented__item-selected) {
    transition: none;
  }
}
@media (max-width: 700px) {
  :global(.music-segmented-scroll) {
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  :global(.music-segmented-scroll::-webkit-scrollbar) {
    display: none;
  }
  :global(.music-segmented.el-segmented) {
    min-width: max-content;
    min-height: 32px;
    font-size: 12px;
  }
  :global(.music-segmented .el-segmented__item) {
    padding-inline: 8px;
  }
}
</style>
