//! Helpers for VRChat location strings such as
//! `wrld_xxx:12345~private(usr_yyy)~canRequestInvite~region(eu)`.

/// True for locations that point at an actual instance.
pub fn is_instance(location: &str) -> bool {
    location.starts_with("wrld_")
}

pub fn world_id(location: &str) -> Option<&str> {
    if is_instance(location) {
        location.split(':').next()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_world_id() {
        let loc = "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b:12345~private(usr_abc)~region(eu)";
        assert_eq!(world_id(loc), Some("wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b"));
        assert_eq!(world_id("private"), None);
        assert_eq!(world_id("offline"), None);
        assert_eq!(world_id("traveling"), None);
    }
}
