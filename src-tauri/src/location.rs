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

/// Who can get into an instance, from its `~tags` (mirrors `parseLocation` in `src/lib/location.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Public,
    FriendsPlus,
    Friends,
    InvitePlus,
    Invite,
    Group,
    GroupPlus,
    GroupPublic,
}

impl Access {
    pub fn label(self) -> &'static str {
        match self {
            Access::Public => "Public",
            Access::FriendsPlus => "Friends+",
            Access::Friends => "Friends",
            Access::InvitePlus => "Invite+",
            Access::Invite => "Invite",
            Access::Group => "Group",
            Access::GroupPlus => "Group+",
            Access::GroupPublic => "Group Public",
        }
    }

    /// Instances you can just walk into, without an invite.
    pub fn is_joinable(self) -> bool {
        !matches!(self, Access::Invite | Access::InvitePlus | Access::Group)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instance<'a> {
    pub world_id: &'a str,
    /// Everything after the colon: `12345~private(usr_yyy)~region(eu)`.
    pub instance_id: &'a str,
    pub access: Access,
    pub region: &'a str,
}

pub fn parse(location: &str) -> Option<Instance<'_>> {
    let (world_id, instance_id) = location.split_once(':')?;
    if !world_id.starts_with("wrld_") {
        return None;
    }
    let mut access = Access::Public;
    let (mut can_request, mut group, mut group_access, mut region) = (false, false, "", "us");
    for tag in instance_id.split('~').skip(1) {
        let (key, value) = match tag.split_once('(') {
            Some((k, v)) => (k, v.strip_suffix(')').unwrap_or(v)),
            None => (tag, ""),
        };
        match key {
            "hidden" => access = Access::FriendsPlus,
            "friends" => access = Access::Friends,
            "private" => access = Access::Invite,
            "canRequestInvite" => can_request = true,
            "group" => group = true,
            "groupAccessType" => group_access = value,
            "region" if !value.is_empty() => region = value,
            _ => {}
        }
    }
    if access == Access::Invite && can_request {
        access = Access::InvitePlus;
    }
    if group {
        access = match group_access {
            "public" => Access::GroupPublic,
            "plus" => Access::GroupPlus,
            _ => Access::Group,
        };
    }
    Some(Instance { world_id, instance_id, access, region })
}

pub fn region_label(region: &str) -> &str {
    match region {
        "us" => "US West",
        "use" => "US East",
        "eu" => "Europe",
        "jp" => "Japan",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_access_and_region() {
        let w = "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b";
        let access = |tags: &str| parse(&format!("{w}:12345{tags}")).unwrap().access;
        assert_eq!(access(""), Access::Public);
        assert_eq!(access("~hidden(usr_a)~region(eu)"), Access::FriendsPlus);
        assert_eq!(access("~friends(usr_a)"), Access::Friends);
        assert_eq!(access("~private(usr_a)"), Access::Invite);
        assert_eq!(access("~private(usr_a)~canRequestInvite~region(jp)"), Access::InvitePlus);
        assert_eq!(access("~group(grp_a)~groupAccessType(public)"), Access::GroupPublic);
        assert_eq!(access("~group(grp_a)~groupAccessType(plus)"), Access::GroupPlus);
        assert_eq!(access("~group(grp_a)~groupAccessType(members)"), Access::Group);

        let loc = format!("{w}:57893~private(usr_a)~region(use)");
        let i = parse(&loc).unwrap();
        assert_eq!((i.world_id, i.instance_id, i.region), (w, "57893~private(usr_a)~region(use)", "use"));
        assert_eq!(parse(&format!("{w}:1")).unwrap().region, "us");
        assert_eq!(parse("private"), None);
        assert_eq!(parse(w), None);
    }

    #[test]
    fn extracts_world_id() {
        let loc = "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b:12345~private(usr_abc)~region(eu)";
        assert_eq!(world_id(loc), Some("wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b"));
        assert_eq!(world_id("private"), None);
        assert_eq!(world_id("offline"), None);
        assert_eq!(world_id("traveling"), None);
    }
}
