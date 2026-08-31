use windows::Win32::Globalization::GetUserDefaultLocaleName;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BootstrapLocale {
    ZhCn,
    ZhTw,
    EnUs,
    JaJp,
    DeDe,
}

impl BootstrapLocale {
    pub const fn code(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::ZhTw => "zh-TW",
            Self::EnUs => "en-US",
            Self::JaJp => "ja-JP",
            Self::DeDe => "de-DE",
        }
    }
}

pub fn locale_from_name(value: &str) -> BootstrapLocale {
    let value = value.trim().to_ascii_lowercase();
    if value.starts_with("zh-tw")
        || value.starts_with("zh-hk")
        || value.starts_with("zh-mo")
        || value.starts_with("zh-hant")
    {
        BootstrapLocale::ZhTw
    } else if value.starts_with("zh") {
        BootstrapLocale::ZhCn
    } else if value.starts_with("ja") {
        BootstrapLocale::JaJp
    } else if value.starts_with("de") {
        BootstrapLocale::DeDe
    } else {
        BootstrapLocale::EnUs
    }
}

/// Detects the Windows locale configured for the current user. This is the
/// locale shown under Windows region settings, rather than the OS install
/// language, so bootstrap UI and a newly installed client agree.
pub fn detect_user_locale() -> BootstrapLocale {
    let mut buffer = [0u16; 85];
    // SAFETY: `buffer` is writable for the documented maximum locale-name
    // length, and the API receives its size through the array reference.
    let length = unsafe { GetUserDefaultLocaleName(&mut buffer) };
    if length <= 1 {
        return BootstrapLocale::EnUs;
    }
    let name_length = usize::try_from(length - 1).unwrap_or_default();
    locale_from_name(&String::from_utf16_lossy(&buffer[..name_length]))
}

#[cfg(test)]
mod tests {
    use super::{locale_from_name, BootstrapLocale};

    #[test]
    fn maps_supported_windows_locale_families() {
        assert_eq!(locale_from_name("zh-CN"), BootstrapLocale::ZhCn);
        assert_eq!(locale_from_name("zh-HK"), BootstrapLocale::ZhTw);
        assert_eq!(locale_from_name("zh-MO"), BootstrapLocale::ZhTw);
        assert_eq!(locale_from_name("zh-Hant"), BootstrapLocale::ZhTw);
        assert_eq!(locale_from_name("ja-JP"), BootstrapLocale::JaJp);
        assert_eq!(locale_from_name("de-AT"), BootstrapLocale::DeDe);
        assert_eq!(locale_from_name("en-GB"), BootstrapLocale::EnUs);
        assert_eq!(locale_from_name("fr-FR"), BootstrapLocale::EnUs);
    }

    #[test]
    fn exposes_client_locale_codes() {
        assert_eq!(BootstrapLocale::ZhCn.code(), "zh-CN");
        assert_eq!(BootstrapLocale::ZhTw.code(), "zh-TW");
        assert_eq!(BootstrapLocale::EnUs.code(), "en-US");
        assert_eq!(BootstrapLocale::JaJp.code(), "ja-JP");
        assert_eq!(BootstrapLocale::DeDe.code(), "de-DE");
    }
}
