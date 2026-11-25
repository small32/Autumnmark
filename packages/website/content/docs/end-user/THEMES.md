# Themes

AutumnMark+ includes 33 built-in themes organized into Light and Dark categories. Each theme provides a color scheme for the editor interface.

The names below match the labels shown in the **Theme** menu. The default light theme, _GitBook Teal_, uses the id `light` in `preferences.json`. The full list of theme names and ids lives in `packages/desktop/src/main/menu/templates/theme.ts`.

## Light Themes

| Theme                 | Description                                    |
| --------------------- | ---------------------------------------------- |
| **Ayu Light**         | Warm, comfortable light theme with soft colors |
| **Catppuccin Latte**  | Soothing pastel theme with warm tones          |
| **Everforest Light**  | Nature-inspired green-tinted light theme       |
| **GitBook Teal**      | Centered titles, teal headings and list markers |
| **Graphite Light**    | Cool gray-toned light theme                    |
| **Gruvbox Light**     | Retro groove with warm, earthy colors          |
| **Rosé Pine Dawn**    | Elegant theme with subtle rose accents         |
| **Solarized Light**   | Classic precision color scheme                 |
| **Tokyo Night Light** | Modern light variant of Tokyo Night            |
| **Ulysses Light**     | Inspired by the Ulysses writing app            |

## Dark Themes

| Theme                 | Description                                 |
| --------------------- | ------------------------------------------- |
| **Ayu Dark**          | Deep, comfortable dark theme                |
| **Ayu Mirage**        | Softer dark variant of Ayu                  |
| **Cadmium Dark**      | Clean, minimal dark theme                   |
| **Catppuccin Mocha**  | Rich, warm dark pastel theme                |
| **cyberdream**        | Neon-accented futuristic dark theme         |
| **Dracula**           | Popular purple-tinted dark theme            |
| **Everforest Dark**   | Nature-inspired forest dark theme           |
| **Gruvbox Dark**      | Retro groove with warm dark colors          |
| **Horizon Dark**      | Vibrant warm dark theme                     |
| **Kanagawa**          | Inspired by Hokusai's Great Wave painting   |
| **Material Dark**     | Google Material Design dark theme           |
| **Monokai Pro**       | Professional variant of the classic Monokai |
| **Nightfox**          | Cool-toned dark theme with good contrast    |
| **Nord**              | Arctic, bluish clean dark theme             |
| **One Dark**          | Atom editor's signature dark theme          |
| **Oxocarbon Dark**    | IBM Carbon-inspired minimal dark theme      |
| **Palenight**         | Elegant purple-tinted dark theme            |
| **Rosé Pine**         | Soho vibes with muted rose tones            |
| **Rosé Pine Moon**    | Darker variant of Rosé Pine                 |
| **Solarized Dark**    | Classic precision dark color scheme         |
| **Synthwave '84**     | Retro 80s neon aesthetic                    |
| **Tokyo Night**       | Modern VSCode-inspired dark theme           |
| **Tokyo Night Storm** | Higher contrast Tokyo Night variant         |

## Switching Themes

Open **Preferences → Theme** to browse and apply local themes. The **Theme → Theme Settings…** menu item and the **Change Theme** command in the command palette open the same page.

Choose **Preview** on a theme card to see the example document in the rendered editor or as Markdown source. **Compare with current theme** shows the same document in both themes. Use **Apply** or **Install and apply** when you are ready to switch.

Click outside the preview or press **Space** to close it. The preview and theme editor share a default sample with headings, inline formatting, tables, lists, code, equations, and footnotes.

**Follow system appearance** is enabled on first launch. Use the light and dark slots to choose a theme for each system appearance. Applying a theme of the current appearance takes effect immediately. Selecting a theme of the other appearance sets it for the next system switch. Choose **Fixed theme** to keep using a single theme.

### Online Themes

Select **Online themes** in Theme settings. **Install only** adds it to **Local themes** for later use. **Install and apply** installs and selects it in one step. Installed themes work offline. Use the refresh button to check for new catalog entries and updates.

In **Local themes**, use **Uninstall theme** for a downloaded theme or **Delete theme** for a custom theme. Any current or system theme selection that used it returns to its built-in base.

## Theme Screenshots

### Light Themes

| Graphite Light                                       |
| ---------------------------------------------------- |
| ![Graphite Light](../themeImages/graphite-light.png) |

| Ulysses Light                                      | Catppuccin Latte                                         |
| -------------------------------------------------- | -------------------------------------------------------- |
| ![Ulysses Light](../themeImages/ulysses-light.png) | ![Catppuccin Latte](../themeImages/catppuccin-latte.png) |

### Dark Themes

| Dark                             | Material Dark                                      |
| -------------------------------- | -------------------------------------------------- |
| ![Dark](../themeImages/dark.png) | ![Material Dark](../themeImages/material-dark.png) |

| One Dark                                 | Dracula                                |
| ---------------------------------------- | -------------------------------------- |
| ![One Dark](../themeImages/one-dark.png) | ![Dracula](../themeImages/dracula.png) |

| Nord                             | Tokyo Night                                    |
| -------------------------------- | ---------------------------------------------- |
| ![Nord](../themeImages/nord.png) | ![Tokyo Night](../themeImages/tokyo-night.png) |

## Custom Themes

Open **Preferences → Theme → Create from current theme** to open the theme editor in its own window. Describe a change in **AI assistant**, or open **CSS source** to edit the same stylesheet directly. **View base CSS** shows the inherited rules. The preview updates as you edit, and drafts are saved automatically.

Use **Save theme only** to add the theme to the picker for later. Saving changes to a downloaded theme creates a custom copy. Open **Save options** and select **Save and apply** to use the saved theme. If you follow the system appearance, this assigns the saved theme to the light or dark slot of its base theme. Use **Export theme** and **Import as a copy** inside the editor to share a theme JSON file.

For conversational editing, open **AI assistant** and enter the base URL of your Chat Completions API, model ID and API key. Local servers can use a loopback HTTP address and an empty key. The model receives the base theme CSS, your CSS overrides and the conversation. Documents you open for preview stay on your device. You can stop generation or undo its changes.

In the theme window, choose **CSS source → Inspect element** to dock Chromium DevTools on the right. Click a heading, paragraph or code block in the preview to select its HTML in **Elements**. Try declarations in **Styles** and copy the ones you want to keep into the CSS editor below the preview. Close DevTools to restore the side-by-side editing layout.

Select a preview node in the **Elements** tree. The CSS toolbar lists its classes. Choose **Add selector** to insert a rule and place the cursor inside it, or **Go to rule** to edit an existing match in your theme. For elements without classes, the toolbar uses the ID or tag name. Both actions take you to the editable stylesheet.

**Custom CSS** in Preferences → Theme is available for personal style overrides.

Open **View → Show Developer Tools** in the editor window. In **Elements**, use the element picker to select part of the editor and try CSS rules in **Styles**. Copy the rules you want to keep into **Preferences → Theme → Custom CSS**.

## Theme Credits

Many of these themes are inspired by popular color schemes from the developer community:

- [Catppuccin](https://github.com/catppuccin/catppuccin)
- [Dracula](https://github.com/dracula/dracula-theme)
- [Everforest](https://github.com/sainnhe/everforest)
- [Gruvbox](https://github.com/morhetz/gruvbox)
- [Nord](https://github.com/nordtheme/nord)
- [Rosé Pine](https://github.com/rose-pine/rose-pine-theme)
- [Solarized](https://github.com/altercation/solarized)
- [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)
- [Gogh Themes](https://github.com/Gogh-Co/Gogh) (color palette reference)
