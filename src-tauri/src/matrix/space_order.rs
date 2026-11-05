//! Choosing `m.space.child` `order` strings for a reordered space.
//!
//! A space lists its children by the `order` field of each `m.space.child`
//! event, compared as plain strings; children without one come after all the
//! ordered children, in Quark by name (see [`ChildKey`]). Moving one room
//! therefore means rewriting some of those strings — and every rewrite is a
//! state event, which a homeserver rate-limits like a message (a burst of ten,
//! then one every few seconds on a default Synapse). Renumbering a 30-room space
//! on every drag would take minutes and flood every member's timeline with
//! state changes.
//!
//! So [`order_updates`] rewrites as few children as it can: it keeps the
//! longest run of existing orders that is already in the target sequence, and
//! squeezes fresh strings into the gaps with [`between`]. Moving one room in a
//! space that has been ordered before is one event.

use std::cmp::Ordering;
use std::collections::HashMap;

/// Lowest character the spec allows in an order string (space).
pub const ORDER_MIN: u8 = 0x20;
/// Highest character the spec allows in an order string (`~`).
pub const ORDER_MAX: u8 = 0x7E;
/// Longest order string the spec allows.
pub const ORDER_MAX_LEN: usize = 50;

/// Whether `order` is one the spec lets a client honour. An invalid order must
/// be ignored, i.e. treated exactly as if the child had none.
pub fn valid_order(order: &str) -> bool {
    order.len() <= ORDER_MAX_LEN && order.bytes().all(|b| (ORDER_MIN..=ORDER_MAX).contains(&b))
}

/// The order string, if it is one a client may honour.
pub fn sanitize_order(order: Option<&str>) -> Option<String> {
    order.filter(|o| valid_order(o)).map(str::to_owned)
}

/// What a child is sorted by.
#[derive(Debug, Clone)]
pub struct ChildKey {
    pub room_id: String,
    /// Already sanitized — see [`sanitize_order`].
    pub order: Option<String>,
    /// The room's display name, the fallback key for unordered children.
    pub name: String,
}

/// How a space's children are listed: ordered children by order string, then
/// unordered ones by name; room ID breaks every tie so the listing never
/// depends on the order the events happened to be read in.
pub fn compare_children(a: &ChildKey, b: &ChildKey) -> Ordering {
    match (&a.order, &b.order) {
        (Some(oa), Some(ob)) => oa.cmp(ob),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    }
    .then_with(|| a.room_id.cmp(&b.room_id))
}

/// A string strictly between `lo` and `hi` (`None` = unbounded), or `None` when
/// no valid order string fits — `""` and `" "` have nothing between them.
pub fn between(lo: Option<&str>, hi: Option<&str>) -> Option<String> {
    let a = lo.unwrap_or("").as_bytes();
    let b = hi.map(str::as_bytes);
    if b.is_some_and(|b| a >= b) {
        return None;
    }

    let below_min = ORDER_MIN as i32 - 1;
    let above_max = ORDER_MAX as i32 + 1;
    let mut out = Vec::new();
    // The upper bound stops mattering once `out` has gone strictly below it.
    let mut bound = b;
    let mut i = 0;
    loop {
        if out.len() >= ORDER_MAX_LEN {
            return None;
        }
        let ca = a.get(i).map_or(below_min, |&c| c as i32);
        let cb = match bound {
            // `out` equals a prefix of `hi`, so `hi` running out here means
            // `out` would have to be longer than `hi` yet below it.
            Some(b) => match b.get(i) {
                Some(&c) => c as i32,
                None => return None,
            },
            None => above_max,
        };
        if cb - ca > 1 {
            out.push(((ca + cb) / 2) as u8);
            return String::from_utf8(out).ok();
        }
        if ca == below_min {
            // `lo` has ended and `hi` has the lowest character here; match it
            // and look for room further along.
            out.push(ORDER_MIN);
        } else {
            out.push(ca as u8);
            if cb > ca {
                bound = None;
            }
        }
        i += 1;
    }
}

/// `count` strictly increasing strings strictly between `lo` and `hi`, kept
/// short by always splitting the remaining range in the middle.
pub fn spread(lo: Option<&str>, hi: Option<&str>, count: usize) -> Option<Vec<String>> {
    if count == 0 {
        return Some(Vec::new());
    }
    let mid = between(lo, hi)?;
    let left_count = count / 2;
    let mut out = spread(lo, Some(&mid), left_count)?;
    let right = spread(Some(&mid), hi, count - left_count - 1)?;
    out.push(mid);
    out.extend(right);
    Some(out)
}

/// Indices into `orders` of a longest strictly increasing subsequence of its
/// `Some` entries.
fn longest_increasing(orders: &[Option<&str>]) -> Vec<usize> {
    let n = orders.len();
    let mut best = vec![0usize; n];
    let mut prev = vec![usize::MAX; n];
    let mut top: Option<usize> = None;
    for i in 0..n {
        let Some(oi) = orders[i] else { continue };
        best[i] = 1;
        for j in 0..i {
            if let Some(oj) = orders[j] {
                if oj < oi && best[j] + 1 > best[i] {
                    best[i] = best[j] + 1;
                    prev[i] = j;
                }
            }
        }
        if top.is_none_or(|t| best[i] > best[t]) {
            top = Some(i);
        }
    }
    let mut out = Vec::new();
    let mut cur = top;
    while let Some(i) = cur {
        out.push(i);
        cur = (prev[i] != usize::MAX).then_some(prev[i]);
    }
    out.reverse();
    out
}

/// The `(room_id, new order)` writes that make `children` list as `target`.
///
/// `target` must be a permutation of the children's room IDs. Children that
/// keep their current order are not in the result.
pub fn order_updates(children: &[ChildKey], target: &[String]) -> Result<Vec<(String, String)>, String> {
    let by_id: HashMap<&str, &ChildKey> = children.iter().map(|c| (c.room_id.as_str(), c)).collect();
    if target.len() != children.len() || target.iter().any(|id| !by_id.contains_key(id.as_str())) {
        return Err("Target order must list every child of the space exactly once".into());
    }
    let seq: Vec<&ChildKey> = target.iter().map(|id| by_id[id.as_str()]).collect();

    // The tail that can stay unordered: children with no order, already in the
    // name order they would fall into anyway. Everything before it has to sort
    // ahead of them, so it all needs an order.
    let mut tail_start = seq.len();
    while tail_start > 0 {
        let c = seq[tail_start - 1];
        if c.order.is_some() {
            break;
        }
        if tail_start < seq.len() && compare_children(c, seq[tail_start]) != Ordering::Less {
            break;
        }
        tail_start -= 1;
    }
    let head = &seq[..tail_start];

    let current: Vec<Option<&str>> = head.iter().map(|c| c.order.as_deref()).collect();
    let kept = longest_increasing(&current);

    let mut assigned: Vec<Option<String>> = vec![None; head.len()];
    for &k in &kept {
        assigned[k] = current[k].map(str::to_owned);
    }
    let fill_gaps = |assigned: &mut Vec<Option<String>>| -> Option<()> {
        let mut gap_start = 0;
        let mut lo: Option<String> = None;
        for i in 0..=assigned.len() {
            let hi = assigned.get(i).cloned().flatten();
            if i == assigned.len() || hi.is_some() {
                let fresh = spread(lo.as_deref(), hi.as_deref(), i - gap_start)?;
                for (slot, order) in assigned[gap_start..i].iter_mut().zip(fresh) {
                    *slot = Some(order);
                }
                lo = hi;
                gap_start = i + 1;
            }
        }
        Some(())
    };
    if fill_gaps(&mut assigned).is_none() {
        // Some kept neighbours had no room between them: renumber the head.
        assigned = vec![None; head.len()];
        fill_gaps(&mut assigned).ok_or("Could not choose order strings for this space")?;
    }

    Ok(head
        .iter()
        .zip(assigned)
        .filter_map(|(child, order)| {
            let order = order?;
            (child.order.as_deref() != Some(order.as_str())).then(|| (child.room_id.clone(), order))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn child(id: &str, order: Option<&str>, name: &str) -> ChildKey {
        ChildKey { room_id: id.into(), order: order.map(Into::into), name: name.into() }
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// Apply `updates` and list the children the way the room list would.
    fn listed(children: &[ChildKey], updates: &[(String, String)]) -> Vec<String> {
        let mut after: Vec<ChildKey> = children.to_vec();
        for (id, order) in updates {
            after.iter_mut().find(|c| &c.room_id == id).unwrap().order = Some(order.clone());
        }
        after.sort_by(compare_children);
        after.into_iter().map(|c| c.room_id).collect()
    }

    #[test]
    fn between_stays_strictly_inside_its_bounds() {
        let cases: &[(Option<&str>, Option<&str>)] = &[
            (None, None),
            (Some("a"), Some("b")),
            (Some("a"), Some("a0")),
            (None, Some("!")),
            (Some("~"), None),
            (Some("a~~"), Some("b")),
            (Some("abc"), Some("abd")),
        ];
        for &(lo, hi) in cases {
            let s = between(lo, hi).unwrap_or_else(|| panic!("no string between {lo:?} and {hi:?}"));
            assert!(valid_order(&s), "{s:?}");
            if let Some(lo) = lo {
                assert!(lo < s.as_str(), "{lo:?} < {s:?}");
            }
            if let Some(hi) = hi {
                assert!(s.as_str() < hi, "{s:?} < {hi:?}");
            }
        }
    }

    #[test]
    fn between_reports_when_nothing_fits() {
        assert_eq!(between(Some("a"), Some("a")), None);
        assert_eq!(between(Some("b"), Some("a")), None);
        // Nothing sorts between a string and the same string plus a space.
        assert_eq!(between(Some("a"), Some("a ")), None);
        assert_eq!(between(None, Some(" ")), None);
    }

    #[test]
    fn spread_is_increasing_and_short() {
        let v = spread(None, None, 40).unwrap();
        assert_eq!(v.len(), 40);
        assert!(v.windows(2).all(|w| w[0] < w[1]));
        assert!(v.iter().all(|s| valid_order(s) && s.len() <= 3), "{v:?}");
    }

    #[test]
    fn invalid_orders_are_ignored() {
        assert!(valid_order("a"));
        assert!(valid_order(""));
        assert!(!valid_order("é"));
        assert!(!valid_order("\t"));
        assert!(!valid_order(&"a".repeat(51)));
        assert_eq!(sanitize_order(Some("ok")), Some("ok".into()));
        assert_eq!(sanitize_order(Some("bad\n")), None);
    }

    #[test]
    fn moving_one_room_in_an_ordered_space_writes_one_event() {
        let kids = [
            child("!a", Some("a"), "A"),
            child("!b", Some("b"), "B"),
            child("!c", Some("c"), "C"),
            child("!d", Some("d"), "D"),
        ];
        let target = ids(&["!a", "!d", "!b", "!c"]);
        let updates = order_updates(&kids, &target).unwrap();
        assert_eq!(updates.len(), 1, "{updates:?}");
        assert_eq!(updates[0].0, "!d");
        assert_eq!(listed(&kids, &updates), target);
    }

    #[test]
    fn an_unordered_space_orders_only_up_to_the_moved_room() {
        // Listed by name: alpha, bravo, charlie, delta. Moving delta to second
        // needs alpha and delta ordered; bravo and charlie can stay as they are.
        let kids = [
            child("!a", None, "alpha"),
            child("!b", None, "bravo"),
            child("!c", None, "charlie"),
            child("!d", None, "delta"),
        ];
        let target = ids(&["!a", "!d", "!b", "!c"]);
        let updates = order_updates(&kids, &target).unwrap();
        let touched: Vec<&str> = updates.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(touched, ["!a", "!d"]);
        assert_eq!(listed(&kids, &updates), target);
    }

    #[test]
    fn moving_an_ordered_room_down_into_the_unordered_tail() {
        let kids = [
            child("!a", Some("a"), "A"),
            child("!b", None, "B"),
            child("!c", None, "C"),
        ];
        let target = ids(&["!b", "!a", "!c"]);
        let updates = order_updates(&kids, &target).unwrap();
        assert_eq!(updates.len(), 1, "{updates:?}");
        assert_eq!(listed(&kids, &updates), target);
    }

    #[test]
    fn a_no_op_writes_nothing() {
        let kids = [child("!a", Some("a"), "A"), child("!b", None, "B"), child("!c", None, "C")];
        assert!(order_updates(&kids, &ids(&["!a", "!b", "!c"])).unwrap().is_empty());
    }

    #[test]
    fn crowded_orders_fall_back_to_renumbering() {
        // "a" and "a " have nothing between them, so putting "!c" there forces
        // the head to be renumbered — and the result must still list right.
        let kids = [
            child("!a", Some("a"), "A"),
            child("!b", Some("a "), "B"),
            child("!c", Some("z"), "C"),
        ];
        let target = ids(&["!a", "!c", "!b"]);
        let updates = order_updates(&kids, &target).unwrap();
        assert_eq!(listed(&kids, &updates), target);
    }

    #[test]
    fn every_permutation_of_a_mixed_space_lists_as_asked() {
        let kids = [
            child("!a", Some("m"), "A"),
            child("!b", None, "B"),
            child("!c", Some("c"), "C"),
            child("!d", None, "D"),
        ];
        let base = ["!a", "!b", "!c", "!d"];
        let mut perm = base.to_vec();
        // Heap's algorithm, iteratively.
        let mut c = vec![0usize; perm.len()];
        let check = |p: &[&str]| {
            let target = ids(p);
            let updates = order_updates(&kids, &target).unwrap();
            assert_eq!(listed(&kids, &updates), target, "updates {updates:?}");
        };
        check(&perm);
        let mut i = 0;
        while i < perm.len() {
            if c[i] < i {
                if i % 2 == 0 { perm.swap(0, i) } else { perm.swap(c[i], i) }
                check(&perm);
                c[i] += 1;
                i = 0;
            } else {
                c[i] = 0;
                i += 1;
            }
        }
    }

    #[test]
    fn a_target_that_is_not_a_permutation_is_refused() {
        let kids = [child("!a", None, "A"), child("!b", None, "B")];
        assert!(order_updates(&kids, &ids(&["!a"])).is_err());
        assert!(order_updates(&kids, &ids(&["!a", "!x"])).is_err());
    }
}
