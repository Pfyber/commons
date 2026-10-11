//! Writes the client's generated protocol codec and its test vectors.

use std::path::PathBuf;

fn main() -> std::io::Result<()> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../client/src/net");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        dir.join("protocol.gen.ts"),
        commons_protocol::ts::generate(),
    )?;
    std::fs::write(
        dir.join("protocol.vectors.json"),
        commons_protocol::ts::sample_vectors(),
    )?;
    println!("wrote {}", dir.canonicalize()?.display());
    Ok(())
}
