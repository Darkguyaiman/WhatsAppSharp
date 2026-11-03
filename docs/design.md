---
name: WhatsApp Web
description: Real-time messenger following the supplied current WhatsApp Web reference.
colors:
  teal: "#21c063"
  teal-text: "#57db91"
  teal-deep: "#008069"
  teal-sent: "#144d37"
  tick-read: "#53bdeb"
  canvas: "#1d1f1f"
  panel: "#161717"
  header: "#161717"
  chat: "#161717"
  search: "#2d2e2e"
  hover: "#252626"
  active: "#2d2e2e"
  border: "#343535"
  text: "#fafafa"
  text-secondary: "#a9abab"
  icon: "#b6b8b8"
  bubble-in: "#242626"
  bubble-text: "#e9edef"
  focus: "#00a884"
  danger: "#f15c6d"
  canvas-light: "#d1d7db"
  panel-light: "#ffffff"
  header-light: "#f0f2f5"
  chat-light: "#efeae2"
  sent-light: "#d9fdd3"
  text-light: "#111b21"
  text-secondary-light: "#667781"
  text-muted-light: "#65747e"
  icon-light: "#54656f"
  border-light: "#e9edef"
  teal-text-light: "#006a55"
  login-cream: "#faf4eb"
  login-outline: "#28312e"
  login-action: "#20ca65"
  login-action-hover: "#19b859"
  login-action-text: "#10271a"
  login-action-border: "#176538"
  login-text: "#17232a"
  login-secondary: "#52615a"
  login-muted: "#626c65"
  login-brand: "#007b37"
  login-link: "#008a42"
  login-field-border: "#7c8981"
typography:
  body:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "14.2px"
    fontWeight: 400
    lineHeight: 1.4
  headline:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  display:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  conv-name:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  message:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  input:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  meta:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "14px"
  auth-title:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "26px"
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  login-heading:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  login-body:
    fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  bubble: "8px"
  control: "8px"
  pill: "24px"
  row: "10px"
  search: "24px"
  composer: "28px"
  welcome: "20px"
  avatar: "50%"
  quote: "6px"
  auth: "4px"
  login-panel: "28px"
  login-panel-mobile: "20px"
  call-panel: "20px"
  call-control: "12px"
  switch-track: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  login-google:
    backgroundColor: "{colors.login-action}"
    textColor: "{colors.login-action-text}"
    rounded: "{rounded.login-panel}"
    padding: "12px 20px"
  login-google-hover:
    backgroundColor: "{colors.login-action-hover}"
  login-panel:
    backgroundColor: "{colors.panel-light}"
    textColor: "{colors.login-text}"
    rounded: "{rounded.login-panel}"
    padding: "30px 40px"
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.teal-deep}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.icon}"
    rounded: "{rounded.avatar}"
    size: "40px"
  button-new-chat:
    backgroundColor: "{colors.text}"
    textColor: "{colors.panel}"
    rounded: "{rounded.avatar}"
    size: "36px"
  input:
    backgroundColor: "{colors.search}"
    textColor: "{colors.text}"
    rounded: "{rounded.search}"
    padding: "0 12px 0 44px"
    height: "38px"
  filter-chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "30px"
  conv-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.row}"
    padding: "0 12px"
    height: "72px"
  conv-row-active:
    backgroundColor: "{colors.active}"
  bubble-sent:
    backgroundColor: "{colors.teal-sent}"
    textColor: "{colors.bubble-text}"
    typography: "{typography.message}"
    rounded: "{rounded.bubble}"
    padding: "6px 9px"
  bubble-received:
    backgroundColor: "{colors.bubble-in}"
    textColor: "{colors.bubble-text}"
    typography: "{typography.message}"
    rounded: "{rounded.bubble}"
    padding: "6px 9px"
  composer:
    backgroundColor: "{colors.bubble-in}"
    rounded: "{rounded.composer}"
    padding: "4px 8px"
    height: "48px"
  welcome-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.welcome}"
    padding: "32px 24px 24px"
    width: "360px"
  preference-switch-track:
    backgroundColor: "{colors.search}"
    rounded: "{rounded.switch-track}"
    width: "46px"
    height: "26px"
    padding: "3px"
  preference-switch-track-checked:
    backgroundColor: "{colors.teal}"
  call-control:
    backgroundColor: "{colors.active}"
    textColor: "{colors.text}"
    rounded: "{rounded.call-control}"
    padding: "12px 14px"
---

# Design System: WhatsApp Web

## Overview

**Creative North Star: "The linked desktop"**

The linked desktop follows the user's supplied current WhatsApp Web screenshots: a full-bleed charcoal workspace, circular navigation tools, a compact conversation list, and a patterned thread. The approved reference supersedes the former blue/slate palette and inset-window geometry. The user's compact-density refinement reduces the scale while preserving that visual grammar. There is no separate invented visual world.

The interface keeps real conversations central. The supplied laptop SVG anchors the welcome card, and the locally served WhatsApp wallpaper tile gives the thread its illustrated ground. Welcome and settings copy must describe this app's actual messaging, installation, and notification actions.

The approved login reference extends this world with a fixed cream ground, white outlined panels, and a green Google action. This scoped account entry stays light independently of the saved chat theme. Profile, communities, statuses, shared media, and calls extend the incumbent messenger palette and typography in both themes. They use actual content, clear headings, and purposeful controls without adding a separate visual world.

**Key Characteristics:**
- Full-bleed desktop shell with a 64px rail and a responsive conversation pane.
- System Segoe UI with regular conversation names and stronger functional headings.
- Neutral charcoal surfaces, green sent bubbles, and green action/state accents.
- Rounded inset list rows, pill fields, and circular avatars.
- Tailed bubbles, readable delivery ticks, and a single rounded composer.
- Login-only cream ground, flat outlined white panels, and a green account action.
- Theme-aware profile and social surfaces with simple lists, real media, and accessible preference switches.

## Colors

Neutral charcoal replaces blue/slate tinting; value changes distinguish navigation, list, selection, composer, and messages.

### Primary
- **Action Green** (`teal`): primary form actions and unread badges.
- **Readable Green** (`teal-text`): links, online status text, and the text caret.
- **Deep Teal** (`teal-deep`): primary-button hover.
- **Sent Green** (`teal-sent`): outgoing message bubbles.

- **Login Green** (`login-action`): the Google sign-in action; hover uses `login-action-hover`, with `login-action-text` and `login-action-border`.
- **Login Brand Green** (`login-brand`) and **Login Link Green** (`login-link`): the account-entry wordmark and underlines/check state.

### Secondary
- **Read Blue** (`tick-read`): read double-checks only.

### Neutral
- **Rail Charcoal** (`canvas`): rail and welcome ground.
- **Panel Charcoal** (`panel`, `header`, `chat`): conversation list, thread header, wallpaper ground, and welcome card.
- **Search Charcoal** (`search`, `active`): search well and selected conversation.
- **Hover Charcoal** (`hover`): hovered rows and filters.
- **Composer Charcoal** (`bubble-in`): received messages and the composer surface.
- **Hairline Charcoal** (`border`): pane dividers and outlined controls.
- **Foreground** (`text`), **Secondary Grey** (`text-secondary`), **Icon Grey** (`icon`), and **Bubble Foreground** (`bubble-text`): functional text hierarchy.

The login scope uses **Cream Ground** (`login-cream`), **Account Outline** (`login-outline`), white `panel-light` panels, **Account Ink** (`login-text`), secondary `login-secondary`, muted `login-muted`, and `login-field-border`. These roles do not override the chat themes.

**The Login Ground Rule.** Keep the sign-in surface light on its fixed cream ground regardless of the saved chat theme.

Focus and presence retain `focus`; destructive feedback uses `danger`. Light theme uses paper panels, a soft grey rail/header, linen chat ground, mint outgoing bubbles, and dark text. The light tokens in the frontmatter record the actual theme overrides, including the final muted-text override.

**The Scarce Accent Rule.** Use green for actions, state, and sent messages; keep the main navigation and panel surfaces neutral.

## Typography

**Display Font:** Segoe UI (system), with Helvetica Neue / Helvetica / Arial fallbacks.
**Body Font:** The same system stack.
**Label/Mono Font:** The same system stack; message and conversation times use tabular numerals.

**Character:** Familiar desktop UI with a clear difference between the bold wordmark, conversation names, and message content. No remote font is required.

### Hierarchy
- **Headline:** bold sidebar wordmark at 22px on desktop and mobile.
- **Display:** regular welcome-card heading at 24px.
- **Title:** semibold thread name at 16px.
- **Conversation name:** regular 16px list title; unread titles use weight 500.
- **Message:** regular 15px bubble content; conversation previews use 14px.
- **Input:** 15px composer text on desktop and 16px on mobile. Search uses 14px desktop and 16px mobile.
- **Label:** 12px thread status; conversation timestamps use 11px desktop and 12px mobile.
- **Meta:** 11px bubble time and delivery footer.
- **Body / Auth title:** inherited account, settings, and form text roles outside the redesigned login.
- **Login heading:** regular 30px desktop, 29px at the login mobile breakpoint; compact tracking and 1.2 line height. Login body and action labels use 16px, with 14px mobile step text. Supplemental notes use 13px and privacy uses 12px.

**The Functional Weight Rule.** Keep conversation names regular. Use stronger weight for the wordmark, thread identity, unread state, and action labels rather than making every label bold.

## Layout

The chat occupies the full viewport, including large desktop screens. The rail is 64px; the list uses clamp(340px, 26vw, 420px), with a 320px minimum and a 42% maximum. The thread takes the remaining width. Both headers are 60px tall.

The sidebar uses 16px header/search/filter insets, a 38px search well, 30px outlined filters, and an 8px inset around the list. Rows are 72px tall with 44px circular avatars, 12px avatar-to-text gaps, and 10px rounded corners. Thread messages use 6% horizontal insets. The composer sits inside the thread with 12px side insets and a 48px minimum row height; it grows for multiline drafts. Its desktop tools are 36px. The welcome card is 360px wide, capped to its container, with a 360px minimum height, a 128×108px illustration, and three 48×48px circular quick-action surfaces beneath it.

Below 1400px, filter padding tightens and the favourite action becomes icon-only. Below 900px, the rail hides and list/thread become separate full screens with a back control. Rows retain their 72px height and 44px avatars; the thread avatar is 40px. Mobile search and filters are 40px tall, composer minimum height is 52px, and composer tools are 40px. Safe-area padding protects the bottom edge. Group sender avatars hide on mobile.

Spacing commonly uses 8 / 12 / 16 / 24. Settings use 24px section spacing and separators; modals scroll inside a viewport-minus-32px maximum height. Profile uses an 860px maximum content width, 40px by 32px desktop padding, and a 200px photo column separated from editable details by 48px. Below 900px it stacks with 28px by 24px padding. Social feature screens occupy the viewport beside the desktop rail and the full viewport on mobile; a fixed header precedes a scrolling body. Status/community/call-history lists are capped at 800px. Their mobile layout and per-feature reading order are recorded in the surface briefs.

The call panel is capped at 560px wide and viewport height minus 32px. Its header and action footer remain visible while the media body scrolls. Video height responds to viewport height; short screens reduce peer/avatar spacing. Preserve reachable answer, decline, mute, camera, and end-call actions on phone landscape as well as desktop.

Login uses a centered 980px maximum content width with 48px total desktop gutters. Its banner uses 16px by 32px padding; the main panel uses 30px by 40px padding and a 32px gap. At 760px and below, gutters become 32px total and main padding becomes 22px by 24px. Login-specific composition and reading order are recorded in `.impeccable/surfaces/login.md`.

## Elevation & Depth

Chat panels, rows, fields, and bubbles remain flat. Background value and thin dividers convey hierarchy; the desktop frame has no shadow or inset border. The wallpaper is a low-opacity mask behind the thread, leaving content in front.

Login panels are flat white surfaces defined by a 1px dark outline against cream. They do not inherit the account-card shadow.

### Shadow Vocabulary
- **Menu** (`0 2px 5px rgba(11,20,26,0.26), 0 2px 10px rgba(11,20,26,0.16)`): message menus, emoji board, and toast.
- **Modal** (`0 17px 50px rgba(11,20,26,0.2)`): modal and inherited account panels.

**The Flat Rest Rule.** List rows, inputs, and bubbles have no drop shadow. Depth is background step or a 1px hairline.

## Shapes

Login panels use broad rounded corners (`login-panel`), reduced on mobile (`login-panel-mobile`), with a 1px Account Outline border. Numbered step markers are 27px outlined circles; the Google action is a green pill.

Avatars and toolbar controls are circular. Filters and text actions are pills. List selection is an inset rounded rectangle. Search, composer, and welcome surfaces use their distinct frontmatter radii; the app frame is square.

Bubbles have rounded corners and an 8px-wide speaker-side triangular tail. The final bubble override rounds all corners; do not inherit the obsolete squared-corner rule. Quotes use a 4px leading green bar and a softly rounded inset block. The bar belongs to quoted content rather than list selection.

## Components

### Buttons
Primary form actions use Action Green, a dark label, pill shape, and 42px height. Normal toolbar and rail tools are 40px circles; the white new-chat action and desktop composer tools are 36px circles. Mobile composer tools remain 40px. Rail icons are 24px, toolbar icons 22px. Hover uses a background/color change over 160ms with the standard easing. Focus-visible remains a 2px teal outline offset 2px.

The favourite action is an outlined pill with an SVG star. Its pressed state fills the star green, and its accessible name changes with state. Compact layouts retain the star button while hiding the text.

### Chips
Outlined filters use the current border and secondary text; the selected dark chip uses a slightly lighter charcoal fill and border. Light selection uses mint. Filters remain horizontally scrollable when space is limited.

### Cards / Containers
Conversation rows use hover and selection fills without separators between each row. The welcome card uses the supplied laptop SVG and a neutral primary action, then new-chat, new-group, and installation shortcuts. It must not advertise calls or end-to-end encryption.

Settings is a scrolling modal with installation and notification sections, theme switching, profile access, and sign-out. These remain available on mobile after the rail disappears. Installation opens platform-appropriate guidance when a browser prompt is unavailable; notification copy reflects browser support, permission, and server configuration.

### Inputs / Fields
Search is a 38px desktop / 40px mobile pill with an inset search SVG. A 1px inset green edge indicates focus. The rounded composer is the single shared surface for attachment, emoji, draft, and send; its inner text field remains transparent. Account fields preserve their 42px height and control radius.

### Navigation
The rail uses Rail Charcoal, 40px circular controls, the filled 24px native SVG paths supplied in the user's reference, and a 28px profile avatar. Top order is Chats, Calls, Status, Groups, and Communities; Communities uses a locally served network icon. Footer order is Media, Settings, and Profile. All entries have working destinations. Tools and Advertise are removed, and Communities replaces Channels. Active navigation uses a neutral selected circle. Below 900px, labelled feature actions expose Calls, Status, Communities, and Media above the conversation list.

Unread and favourites remain available through sidebar filters; new chat remains in the header and welcome actions. Installation and theme controls remain in settings, with installation also in the welcome actions. Favourites use real account data and are saved per account in the current browser.

Escape dismisses the visible modal/menu, emoji picker, or chat-search drawer first. With no overlay open, it clears the active conversation and returns desktop to the welcome view or mobile to the conversation list, then focuses chat search. Text, attachment, and reply drafts restore when reopening that conversation within the current page. These drafts do not survive a reload.

### Avatars
Default individual avatars use the first two letters of the display name, uppercased with Unicode-aware letter selection; names with no letters show “?”. Default group avatars use the user's supplied filled two-person SVG path. Both render locally on a circular background from the ten dark colours in `Models/AvatarAppearance.cs`, selected randomly once and saved for that account/group. White foreground contrasts with every allowed background by at least 4.5:1; avatar colours do not replace the shell palette.

The SVG has a 48×48 viewBox. Individual letters use 18px semibold Segoe UI / Arial; the group symbol is centered at 22×22 within that viewBox. Existing list, thread, sender, rail, and profile avatar sizes scale this same appearance. Preserve custom photo URLs. Legacy generic bundled avatars are defaults; registration uses the name avatar, and profile offers “Use initials” alongside photo upload.

### Message bubble
Sent Green outgoing messages and Composer Charcoal incoming messages use a 70% desktop maximum width and 86% mobile maximum. Message time and ticks sit at the trailing edge. Reactions overlap beneath the bubble with reserved space so the next row stays readable. Group messages show sender names in a repeating readable color set and 28px sender avatars on desktop; the header lists actual member names.

### Auth card
Legacy account cards retain one surface, a 4px radius, and the modal shadow. The redesigned login has separate flat outlined panels and no demo account list. Profile now uses a full-height, scrollable themed page with a plain bordered header, photo controls, and labelled fields; it does not inherit the login's fixed cream scope.

### Preference switches
Dark mode and message sounds use an accessible button switch with a visibly contrasting track and circular thumb. Checked state uses Action Green with a dark thumb translated 20px. Sun/moon icons frame the theme control. Keyboard focus uses the incumbent focus outline; track and thumb transition over 180ms and stop animating for reduced motion. Sound preview remains a separate labelled action.

### Social rows and media
Status/community rows use hairline separators, neutral hover fills, 56px circular identity markers, regular-to-medium names, and secondary metadata. Unviewed status rings use Action Green and viewed rings use Icon Grey. The media library shows real uploaded thumbnails or file icons, filenames, sender/time metadata, and an explicit open-chat action. Status background choices are content-specific presets, not new global brand colors.

### Call panel
The themed rounded dialog uses the incumbent modal shadow and a dim backdrop. Peer identity and live connection status precede actual remote media and a small local preview. Neutral controls use text labels beneath icons; answer is green and end/decline is red. Checked mute/camera controls use the sent-message treatment. Quality feedback stays beside the media; persistent actions remain outside its scroll region. Minimized calls return through a small labelled floating control.

### Login account action
Google is the primary full-width green pill with a 54px minimum height, 12px by 20px padding, a local Google mark, and a trailing arrow. Hover darkens the green; focus-visible uses a 3px Deep Teal outline offset 4px. Google is the only login method; profiles are created on first sign-in. Remember-me checkboxes are 18px. An unavailable Google provider produces an inline alert; password sign-in is unavailable. These states must not suggest that unconfigured OAuth is working.

## Do's and Don'ts

### Do:
- **Do** preserve the approved cream login scope and its flat white outlined panels independently of chat theme.
- **Do** follow the supplied current WhatsApp screenshots for the charcoal shell, with the user's requested compact component geometry.
- **Do** use system Segoe UI with regular names and purposeful heading/action weight.
- **Do** keep green tied to actions, state, and outgoing messages.
- **Do** preserve mobile back navigation, safe-area spacing, keyboard focus, and reduced-motion behavior.
- **Do** keep settings and installation available when the mobile rail is hidden.
- **Do** show delivery with ticks and actual presence with a static dot.

### Don't:
- **Don't** restore the superseded blue/slate palette or large-screen inset app window.
- **Don't** load remote fonts or Tailwind CDN as the visual system.
- **Don't** claim end-to-end encryption, WhatsApp account integration, group calling, or guaranteed connectivity on every network.
- **Don't** bold every label or add decorative pulse animations.
- **Don't** turn screenshot conversation data into app content.


