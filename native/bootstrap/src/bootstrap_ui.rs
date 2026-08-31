pub const FONT_FAMILY: &str = "Segoe UI";
pub const TITLE_FONT_SIZE: u32 = 36;
pub const TITLE_FONT_WEIGHT: u32 = 700;
pub const BODY_FONT_SIZE: u32 = 24;
pub const BUTTON_FONT_SIZE: u32 = 20;
pub const BUTTON_FONT_WEIGHT: u32 = 600;
// Windows ICO resources provide a maximum 256×256 layer. Load that highest
// quality layer once and let Windows downscale it for the title bar/taskbar DPI.
pub const WINDOW_ICON_SIZE: (u32, u32) = (256, 256);
