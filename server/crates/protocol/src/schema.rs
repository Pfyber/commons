//! Declarative message definitions. The macros generate Rust types, their
//! binary codec and a runtime schema that `gen-ts` turns into TypeScript.

use crate::wire::Ty;

pub struct RecordSchema {
    pub name: &'static str,
    pub fields: Vec<(&'static str, Ty)>,
}

pub struct VariantSchema {
    pub tag: u8,
    pub name: &'static str,
    pub fields: Vec<(&'static str, Ty)>,
}

pub struct EnumSchema {
    pub name: &'static str,
    pub variants: Vec<VariantSchema>,
}

#[macro_export]
macro_rules! records {
    ($( $(#[$m:meta])* $name:ident { $( $f:ident : $t:ty ),* $(,)? } )*) => {
        $(
            $(#[$m])*
            #[derive(Debug, Clone, PartialEq, Eq, Default)]
            pub struct $name { $( pub $f: $t ),* }

            impl $crate::wire::Wire for $name {
                fn enc(&self, out: &mut Vec<u8>) {
                    $( $crate::wire::Wire::enc(&self.$f, out); )*
                }
                fn dec(buf: &mut &[u8]) -> Result<Self, $crate::wire::DecodeError> {
                    Ok(Self { $( $f: <$t as $crate::wire::Wire>::dec(buf)? ),* })
                }
                fn ty() -> $crate::wire::Ty {
                    $crate::wire::Ty::Record(stringify!($name))
                }
            }
        )*

        pub fn record_schemas() -> Vec<$crate::schema::RecordSchema> {
            vec![ $( $crate::schema::RecordSchema {
                name: stringify!($name),
                fields: vec![ $( (stringify!($f), <$t as $crate::wire::Wire>::ty()) ),* ],
            } ),* ]
        }
    };
}

#[macro_export]
macro_rules! message_enum {
    ($(#[$m:meta])* $name:ident {
        $( $(#[$vm:meta])* $tag:literal $var:ident { $( $f:ident : $t:ty ),* $(,)? } )*
    }) => {
        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Eq)]
        pub enum $name { $( $(#[$vm])* $var { $( $f: $t ),* } ),* }

        impl $name {
            pub fn encode(&self, out: &mut Vec<u8>) {
                match self {
                    $( $name::$var { $( $f ),* } => {
                        out.push($tag);
                        $( $crate::wire::Wire::enc($f, out); )*
                    } )*
                }
            }

            pub fn to_bytes(&self) -> Vec<u8> {
                let mut out = Vec::new();
                self.encode(&mut out);
                out
            }

            pub fn decode(mut buf: &[u8]) -> Result<Self, $crate::wire::DecodeError> {
                let tag = <u8 as $crate::wire::Wire>::dec(&mut buf)?;
                let msg = match tag {
                    $( $tag => $name::$var { $( $f: <$t as $crate::wire::Wire>::dec(&mut buf)? ),* }, )*
                    t => return Err($crate::wire::DecodeError::UnknownTag(t)),
                };
                if !buf.is_empty() {
                    return Err($crate::wire::DecodeError::Trailing(buf.len()));
                }
                Ok(msg)
            }

            pub fn name(&self) -> &'static str {
                match self { $( $name::$var { .. } => stringify!($var), )* }
            }

            pub fn schema() -> $crate::schema::EnumSchema {
                $crate::schema::EnumSchema {
                    name: stringify!($name),
                    variants: vec![ $( $crate::schema::VariantSchema {
                        tag: $tag,
                        name: stringify!($var),
                        fields: vec![ $( (stringify!($f), <$t as $crate::wire::Wire>::ty()) ),* ],
                    } ),* ],
                }
            }
        }
    };
}
