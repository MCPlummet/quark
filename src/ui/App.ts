// Root layout component — full application layout assembly

import { LoginScreen } from "./LoginScreen.js";
import { SpaceStrip } from "./SpaceStrip.js";
import { RoomList } from "./RoomList.js";
import { HomeView } from "./HomeView.js";
import { RoomHeader } from "./RoomHeader.js";
import { Timeline } from "./Timeline.js";
import { ReplyPreview } from "./ReplyPreview.js";
import { Input } from "./Input.js";
import { StatusBar } from "./StatusBar.js";
import { CommandBar } from "./CommandBar.js";
import { ThreadView } from "./ThreadView.js";
import { MemberList } from "./MemberList.js";
import { EmojiPicker } from "./EmojiPicker.js";
import { GifPicker } from "./GifPicker.js";
import { HelpDialog } from "./HelpDialog.js";
import { Verification } from "./Verification.js";
import { VerificationPromptDialog } from "./VerificationPromptDialog.js";
import { DevicePicker } from "./DevicePicker.js";
import { ShortcodePreview } from "./ShortcodePreview.js";
import { QuickReactPicker } from "./QuickReactPicker.js";
import { ProfileDialog } from "./ProfileDialog.js";
import { ProfileEditDialog } from "./ProfileEditDialog.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { RoomInfoDialog } from "./RoomInfoDialog.js";
import { PinnedMessagesDialog } from "./PinnedMessagesDialog.js";
import { SearchDialog } from "./SearchDialog.js";
import { RoomDirectoryDialog } from "./RoomDirectoryDialog.js";
import { ImageLightbox } from "./ImageLightbox.js";
import { QuickNavPalette } from "./QuickNavPalette.js";
import { MentionPreview } from "./MentionPreview.js";
import { RoomSettingsDialog } from "./RoomSettingsDialog.js";
import { SpaceSettingsDialog } from "./SpaceSettingsDialog.js";
import { DebugViewer } from "./DebugViewer.js";
import { RevisionHistoryDialog } from "./RevisionHistoryDialog.js";
import { ContextMenu } from "./ContextMenu.js";
import { MobileTopBar } from "./MobileTopBar.js";
import { UpdateBanner } from "./UpdateBanner.js";
import { initMobile, isMobile, openDrawer, closeDrawer, toggleDrawer, onMobileChange, onDrawerChange } from "../app/mobile.js";
import { setupTouchGestures } from "../app/touch.js";
import { AppState } from "../app/state.js";
import { toggleMemberList, closeThread } from "../app/actions.js";

// ── AppComponents ─────────────────────────────────────────────────────────────

export interface AppComponents {
  // Pre-auth
  loginScreen: LoginScreen;

  // Navigation
  spaceStrip: SpaceStrip;
  roomList: RoomList;
  homeView: HomeView;

  // Main panel
  roomHeader: RoomHeader;
  timeline: Timeline;
  replyPreview: ReplyPreview;
  input: Input;

  // Sidebars
  threadView: ThreadView;
  memberList: MemberList;

  // Overlays
  emojiPicker: EmojiPicker;
  gifPicker: GifPicker;
  verification: Verification;
  verificationPrompt: VerificationPromptDialog;
  devicePicker: DevicePicker;
  shortcodePreview: ShortcodePreview;
  helpDialog: HelpDialog;
  commandBar: CommandBar;
  quickReactPicker: QuickReactPicker;
  profileDialog: ProfileDialog;
  profileEditDialog: ProfileEditDialog;
  settingsDialog: SettingsDialog;
  roomInfoDialog: RoomInfoDialog;
  pinnedMessagesDialog: PinnedMessagesDialog;
  searchDialog: SearchDialog;
  roomDirectoryDialog: RoomDirectoryDialog;
  imageLightbox: ImageLightbox;
  quickNavPalette: QuickNavPalette;
  mentionPreview: MentionPreview;
  roomSettingsDialog: RoomSettingsDialog;
  spaceSettingsDialog: SpaceSettingsDialog;
  debugViewer: DebugViewer;
  revisionHistoryDialog: RevisionHistoryDialog;
  contextMenu: ContextMenu;

  // Mobile-only UI
  mobileTopBar: MobileTopBar;
  mobileBackdrop: HTMLElement;

  // Status
  statusBar: StatusBar;
  updateBanner: UpdateBanner;

  // Typing indicator element (below compose box)
  typingIndicator: HTMLElement;

  // Layout roots (for show/hide)
  mainLayout: HTMLElement;
}

/**
 * Mount the full Quark UI into the given container.
 * Shows the login screen initially; call showMainLayout() after login.
 */
export function mountApp(container: HTMLElement): AppComponents {
  container.innerHTML = "";

  // ── Instantiate all components ───────────────────────────────────────────

  const loginScreen = new LoginScreen();
  const spaceStrip = new SpaceStrip();
  const roomList = new RoomList();
  const homeView = new HomeView();
  const roomHeader = new RoomHeader();
  const timeline = new Timeline();
  const replyPreview = new ReplyPreview();
  const input = new Input();
  const statusBar = new StatusBar();
  const updateBanner = new UpdateBanner();
  const commandBar = new CommandBar();
  const threadView = new ThreadView();
  const memberList = new MemberList();
  const emojiPicker = new EmojiPicker();
  const gifPicker = new GifPicker();
  const verification = new Verification();
  const verificationPrompt = new VerificationPromptDialog();
  const devicePicker = new DevicePicker();
  const shortcodePreview = new ShortcodePreview();
  const helpDialog = new HelpDialog();
  const quickReactPicker = new QuickReactPicker();
  const profileDialog = new ProfileDialog();
  const profileEditDialog = new ProfileEditDialog();
  const settingsDialog = new SettingsDialog();
  const roomInfoDialog = new RoomInfoDialog();
  const pinnedMessagesDialog = new PinnedMessagesDialog();
  const searchDialog = new SearchDialog(timeline);
  const roomDirectoryDialog = new RoomDirectoryDialog();
  const imageLightbox = new ImageLightbox();
  const quickNavPalette = new QuickNavPalette();
  const mentionPreview = new MentionPreview();
  const roomSettingsDialog = new RoomSettingsDialog();
  const spaceSettingsDialog = new SpaceSettingsDialog();
  const debugViewer = new DebugViewer();
  const revisionHistoryDialog = new RevisionHistoryDialog();
  const contextMenu = new ContextMenu();
  const mobileTopBar = new MobileTopBar();

  // ── Login screen ─────────────────────────────────────────────────────────
  container.appendChild(loginScreen.getElement());

  // ── Main layout (hidden until login succeeds) ─────────────────────────────
  const mainLayout = document.createElement("div");
  mainLayout.className = "quark-layout";
  mainLayout.style.display = "none";

  // Column 1: Space strip
  mainLayout.appendChild(spaceStrip.getElement());

  // Column 2: Room list
  mainLayout.appendChild(roomList.getElement());

  // Home view canvas — replaces the room list + content columns while the
  // Home pseudo-space is active (desktop only). Hidden until entered; the
  // .quark-layout--home modifier swaps the grid.
  mainLayout.appendChild(homeView.getElement());

  // Column 3: Content area (room header + timeline + reply preview + input)
  const contentArea = document.createElement("div");
  contentArea.className = "content-area";

  // Mobile-only top bar — hidden on desktop via CSS
  contentArea.appendChild(mobileTopBar.getElement());

  contentArea.appendChild(roomHeader.getElement());
  contentArea.appendChild(timeline.getElement());
  contentArea.appendChild(replyPreview.getElement());

  // Shortcode / mention previews sit above input bar
  contentArea.appendChild(shortcodePreview.getElement());
  contentArea.appendChild(mentionPreview.getElement());
  contentArea.appendChild(commandBar.getElement());
  contentArea.appendChild(input.getElement());

  // Typing indicator sits below the input bar
  const typingIndicator = document.createElement("div");
  typingIndicator.className = "typing-indicator";
  const typingDots = document.createElement("span");
  typingDots.className = "typing-indicator__dots";
  typingDots.innerHTML = "<span></span><span></span><span></span>";
  typingIndicator.appendChild(typingDots);
  const typingText = document.createElement("span");
  typingText.className = "typing-indicator__text";
  typingIndicator.appendChild(typingText);
  contentArea.appendChild(typingIndicator);

  mainLayout.appendChild(contentArea);

  // Column 4: Thread view sidebar (hidden by default)
  mainLayout.appendChild(threadView.getElement());

  // Column 5: Member list sidebar (hidden by default)
  mainLayout.appendChild(memberList.getElement());

  // Mobile drawer backdrop — sits over the content area while the drawer is open.
  // Only visible when body has both .quark-mobile and .quark-mobile-drawer-open.
  const mobileBackdrop = document.createElement("div");
  mobileBackdrop.className = "mobile-backdrop";
  mobileBackdrop.setAttribute("aria-hidden", "true");
  mobileBackdrop.addEventListener("click", () => closeDrawer());
  mainLayout.appendChild(mobileBackdrop);

  container.appendChild(mainLayout);

  // ── Mobile mode bootstrap ─────────────────────────────────────────────────
  initMobile();
  // Now that mobile state is known, re-apply the compose field's soft-keyboard
  // assist attributes (constructor ran before initMobile with the desktop default).
  input.applyTextAssist();
  setupTouchGestures(mainLayout, {
    scrollEl: roomList.getScrollElement(),
    // The quick-nav palette (Ctrl+K on desktop) is unreachable by touch. Pulling
    // down from the top of the room list opens it; close the drawer first so the
    // palette is visible and focused. (mobile quick-nav access)
    onPullDown: () => {
      closeDrawer();
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: "open-quick-nav" } }));
    },
  });
  mobileTopBar.onHamburgerClick(() => toggleDrawer());
  // The @ button on the right mirrors the desktop `@` keybinding — opens the
  // member list as a full-screen overlay on mobile.
  mobileTopBar.onMembersClick(() => toggleMemberList());
  // Mobile-only: tapping the "Rooms" header in the drawer closes it. On
  // desktop the header is purely decorative, so the listener is a no-op
  // when isMobile() is false.
  roomList.getHeaderElement().addEventListener("click", () => {
    if (isMobile()) closeDrawer();
  });
  // Same affordance on the member-list: on mobile, the header doubles as a
  // close button since the desktop sidebar's @ toggle in the top bar is
  // covered by the full-screen overlay.
  memberList.getHeaderElement().addEventListener("click", () => {
    if (isMobile() && AppState.get("memberListVisible")) toggleMemberList();
  });
  // mobileTopBar.onMembersClick is wired from main.ts (needs the action layer).
  // Close the drawer automatically after a room is selected (tap-and-go flow).
  // Subscribe to currentRoomId rather than RoomList.onSelect — main.ts already
  // owns that callback slot.
  AppState.on("currentRoomId", () => {
    if (isMobile()) closeDrawer();
  });

  // Mobile is one-overlay-at-a-time: opening the drawer dismisses the
  // member list / thread view so they don't overlap. The opposite direction
  // (opening member list closes drawer) is handled in toggleMemberList /
  // openThread inside actions.ts.
  onDrawerChange((open) => {
    if (!open || !isMobile()) return;
    if (AppState.get("memberListVisible")) toggleMemberList();
    if (AppState.get("threadRootEventId")) closeThread();
  });

  // Keep the mobile top bar's title in sync with the active room.
  // The avatar is updated from actions.ts:selectRoom once the avatar URL has
  // resolved; here we just keep the title (and reset the avatar when no room
  // is selected so the bar doesn't show the previous room's initial).
  const updateMobileTitle = (): void => {
    const roomId = AppState.get("currentRoomId");
    if (!roomId) {
      mobileTopBar.setTitle("Quark");
      mobileTopBar.setRoom("", null);
      mobileTopBar.setMembersButtonVisible(false);
      return;
    }
    const room = AppState.get("roomListCache").find((r) => r.room_id === roomId);
    mobileTopBar.setTitle(room?.name ?? roomId);
    mobileTopBar.setMembersButtonVisible(true);
  };
  AppState.on("currentRoomId", updateMobileTitle);
  AppState.on("roomListCache", updateMobileTitle);
  onMobileChange(updateMobileTitle);

  // ── Align compose-box right edge with message bubbles ────────────────────
  // The timeline scrollbar takes space from its content area (classic scrollbars)
  // or nothing (overlay scrollbars on macOS). Measure the actual gutter width at
  // runtime so the input-bar's padding-right always matches — regardless of OS
  // scrollbar style, user preferences, or DPI.
  const timelineEl = timeline.getScrollElement();
  const inputBarEl = input.getInputBarElement();
  const syncComposeRight = () => {
    const gutterPx = timelineEl.offsetWidth - timelineEl.clientWidth;
    inputBarEl.style.paddingRight = `${12 + gutterPx}px`;
  };
  syncComposeRight();
  new ResizeObserver(syncComposeRight).observe(timelineEl);

  // ── Status bar (fixed bottom-right, floats over content) ─────────────────
  container.appendChild(statusBar.getElement());

  // Update banner (fixed top-center, floats over content; hidden until offered)
  container.appendChild(updateBanner.getElement());

  // ── Overlays (appended to body so they float above everything) ───────────
  document.body.appendChild(emojiPicker.getElement());
  document.body.appendChild(gifPicker.getElement());
  document.body.appendChild(verification.getElement());
  document.body.appendChild(verificationPrompt.getElement());
  document.body.appendChild(devicePicker.getElement());
  document.body.appendChild(helpDialog.getElement());
  document.body.appendChild(quickReactPicker.getElement());
  document.body.appendChild(profileDialog.getElement());
  document.body.appendChild(profileEditDialog.getElement());
  document.body.appendChild(settingsDialog.getElement());
  document.body.appendChild(roomInfoDialog.getElement());
  document.body.appendChild(pinnedMessagesDialog.getElement());
  document.body.appendChild(searchDialog.getElement());
  document.body.appendChild(roomDirectoryDialog.getElement());
  document.body.appendChild(imageLightbox.getElement());
  document.body.appendChild(quickNavPalette.getElement());
  document.body.appendChild(roomSettingsDialog.getElement());
  document.body.appendChild(spaceSettingsDialog.getElement());
  document.body.appendChild(debugViewer.getElement());
  document.body.appendChild(revisionHistoryDialog.getElement());

  return {
    loginScreen,
    spaceStrip,
    roomList,
    homeView,
    roomHeader,
    timeline,
    replyPreview,
    input,
    statusBar,
    updateBanner,
    commandBar,
    threadView,
    memberList,
    emojiPicker,
    gifPicker,
    verification,
    verificationPrompt,
    devicePicker,
    shortcodePreview,
    helpDialog,
    quickReactPicker,
    profileDialog,
    profileEditDialog,
    settingsDialog,
    roomInfoDialog,
    pinnedMessagesDialog,
    searchDialog,
    roomDirectoryDialog,
    imageLightbox,
    quickNavPalette,
    mentionPreview,
    roomSettingsDialog,
    spaceSettingsDialog,
    debugViewer,
    revisionHistoryDialog,
    contextMenu,
    mobileTopBar,
    mobileBackdrop,
    typingIndicator,
    mainLayout,
  };
}

/**
 * Transition from login screen to main app layout.
 */
export function showMainLayout(components: AppComponents): void {
  components.loginScreen.hide();
  components.mainLayout.style.display = "";
  // On mobile, open the room-list drawer so the user lands on the room list
  // rather than an empty timeline. Only when no room is active yet (fresh login
  // or session restore — no room is auto-selected on startup); selecting a room
  // closes the drawer again (see selectRoom). (#52)
  if (isMobile() && !AppState.get("currentRoomId")) openDrawer();
}
