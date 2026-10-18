// The migrations are embedded at compile time (`sqlx::migrate!`), so a new
// migration file must trigger a rebuild, or the server keeps the old set.
fn main() {
    println!("cargo:rerun-if-changed=../../migrations");
}
