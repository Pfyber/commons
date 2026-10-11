//! Binary encoding primitives. All integers are little-endian; strings and
//! vectors carry a u16 length prefix.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    Eof,
    Utf8,
    UnknownTag(u8),
    Trailing(usize),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecodeError::Eof => write!(f, "unexpected end of message"),
            DecodeError::Utf8 => write!(f, "invalid utf-8 string"),
            DecodeError::UnknownTag(t) => write!(f, "unknown message tag {t}"),
            DecodeError::Trailing(n) => write!(f, "{n} trailing bytes after message"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// Type description used by the TypeScript generator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ty {
    U8,
    U16,
    U32,
    Bool,
    Str,
    Vec(Box<Ty>),
    Record(&'static str),
}

pub trait Wire: Sized {
    fn enc(&self, out: &mut Vec<u8>);
    fn dec(buf: &mut &[u8]) -> Result<Self, DecodeError>;
    fn ty() -> Ty;
}

fn take<'a>(buf: &mut &'a [u8], n: usize) -> Result<&'a [u8], DecodeError> {
    if buf.len() < n {
        return Err(DecodeError::Eof);
    }
    let (head, tail) = buf.split_at(n);
    *buf = tail;
    Ok(head)
}

macro_rules! int_wire {
    ($t:ty, $n:literal, $ty:ident) => {
        impl Wire for $t {
            fn enc(&self, out: &mut Vec<u8>) {
                out.extend_from_slice(&self.to_le_bytes());
            }
            fn dec(buf: &mut &[u8]) -> Result<Self, DecodeError> {
                let b = take(buf, $n)?;
                Ok(<$t>::from_le_bytes(b.try_into().unwrap()))
            }
            fn ty() -> Ty {
                Ty::$ty
            }
        }
    };
}

int_wire!(u8, 1, U8);
int_wire!(u16, 2, U16);
int_wire!(u32, 4, U32);

impl Wire for bool {
    fn enc(&self, out: &mut Vec<u8>) {
        out.push(*self as u8);
    }
    fn dec(buf: &mut &[u8]) -> Result<Self, DecodeError> {
        Ok(u8::dec(buf)? != 0)
    }
    fn ty() -> Ty {
        Ty::Bool
    }
}

impl Wire for String {
    fn enc(&self, out: &mut Vec<u8>) {
        let mut len = self.len().min(u16::MAX as usize);
        while !self.is_char_boundary(len) {
            len -= 1;
        }
        (len as u16).enc(out);
        out.extend_from_slice(&self.as_bytes()[..len]);
    }
    fn dec(buf: &mut &[u8]) -> Result<Self, DecodeError> {
        let len = u16::dec(buf)? as usize;
        let b = take(buf, len)?;
        String::from_utf8(b.to_vec()).map_err(|_| DecodeError::Utf8)
    }
    fn ty() -> Ty {
        Ty::Str
    }
}

impl<T: Wire> Wire for Vec<T> {
    fn enc(&self, out: &mut Vec<u8>) {
        let len = self.len().min(u16::MAX as usize);
        (len as u16).enc(out);
        for item in &self[..len] {
            item.enc(out);
        }
    }
    fn dec(buf: &mut &[u8]) -> Result<Self, DecodeError> {
        let len = u16::dec(buf)? as usize;
        // Every element is at least one byte; reject impossible lengths before allocating.
        if len > buf.len() {
            return Err(DecodeError::Eof);
        }
        let mut v = Vec::with_capacity(len);
        for _ in 0..len {
            v.push(T::dec(buf)?);
        }
        Ok(v)
    }
    fn ty() -> Ty {
        Ty::Vec(Box::new(T::ty()))
    }
}

/// A frame is one WebSocket binary message holding a batch of
/// `[u16 length][message bytes]` entries.
pub fn push_framed(frame: &mut Vec<u8>, msg: &[u8]) {
    debug_assert!(msg.len() <= u16::MAX as usize);
    (msg.len() as u16).enc(frame);
    frame.extend_from_slice(msg);
}

/// Iterates the messages of a frame. Yields an error and stops on a truncated entry.
pub fn split_frame(mut frame: &[u8]) -> impl Iterator<Item = Result<&[u8], DecodeError>> {
    std::iter::from_fn(move || {
        if frame.is_empty() {
            return None;
        }
        let r = u16::dec(&mut frame).and_then(|len| take(&mut frame, len as usize));
        if r.is_err() {
            frame = &[];
        }
        Some(r)
    })
}
