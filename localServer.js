import browserSync from "browser-sync";
const bs = browserSync.create();
bs.init({
    server: '.',
    files: ["lib"],
    middleware: [
        (req, res, next) => {
            res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
            res.setHeader('Cross-Origin-Opener-Policy','same-origin');
            next();
        }
    ]
});
bs.watch("*.html").on("change",bs.reload);
bs.watch("*.css").on("change",bs.reload);
bs.watch("*.js").on("change", bs.reload);