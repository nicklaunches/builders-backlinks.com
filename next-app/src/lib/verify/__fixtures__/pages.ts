/**
 * @file Static HTML fixtures for link verification tests.
 *
 * These are strings, not files served over HTTP. The point is to test the
 * scanning and classification logic (the part that carries the judgment calls)
 * without standing up a server or reaching the network. Tests that need a real
 * fetch should stub `fetchSiteHtml` and hand it one of these bodies.
 *
 * Each fixture is a full document with `<html>` and `<body>` because placement
 * classification cares about landmark ancestors, and a bare fragment would not
 * exercise it.
 */

/** The domain every fixture below links at (or deliberately does not). */
export const FIXTURE_TARGET_DOMAIN = "example-target.com";

/** The page URL the fixtures pretend to have been fetched from. */
export const FIXTURE_PAGE_URL = "https://host-site.dev/blog/how-we-launched";

/**
 * Link inside an article body. Expected: found, placement `content`, rel `[]`.
 *
 * Includes decoys the scanner must not fall for: a link to a subdomain of the
 * target, a link in a `<script>` block, and a link inside an HTML comment.
 */
export const FIXTURE_LINK_IN_CONTENT = `<!doctype html>
<html lang="en">
<head><title>How we launched</title></head>
<body>
    <header class="site-header">
        <nav aria-label="Main"><a href="/">Home</a><a href="/blog">Blog</a></nav>
    </header>
    <main>
        <article class="post">
            <h1>How we launched</h1>
            <p>
                We ended up using <a href="https://example-target.com/pricing">the pricing calculator</a>
                more than anything else.
            </p>
            <p>Their <a href="https://blog.example-target.com/changelog">changelog</a> is a subdomain, not the target.</p>
            <!-- <a href="https://example-target.com/commented-out">commented out</a> -->
            <script>
                document.write('<a href="https://example-target.com/from-js">rendered later</a>');
            </script>
        </article>
    </main>
    <footer class="site-footer"><p>&copy; Host Site</p></footer>
</body>
</html>`;

/**
 * Link in the site footer. Expected: found, placement `footer`.
 *
 * Reported plainly and still counts as a placed link. See the policy note in
 * `src/lib/verify/index.ts`.
 */
export const FIXTURE_LINK_IN_FOOTER = `<!doctype html>
<html lang="en">
<head><title>Tools we use</title></head>
<body>
    <main>
        <article>
            <h1>Tools we use</h1>
            <p>Nothing here links out.</p>
        </article>
    </main>
    <footer id="footer">
        <div class="footer-links">
            <a href="/about">About</a>
            <a href="https://www.example-target.com/">Example Target</a>
            <a href="/contact">Contact</a>
        </div>
    </footer>
</body>
</html>`;

/**
 * Content link carrying `rel="nofollow sponsored"`. Expected: found, placement
 * `content`, rel `["nofollow", "sponsored"]`, and a message that discloses the
 * rel without treating it as a failure.
 */
export const FIXTURE_LINK_WITH_NOFOLLOW = `<!doctype html>
<html lang="en">
<head><title>Sponsored roundup</title></head>
<body>
    <main>
        <article class="entry-content">
            <h1>Sponsored roundup</h1>
            <p>
                Our pick this month is
                <a href="https://example-target.com/?ref=host-site" rel="NOFOLLOW  sponsored">Example&nbsp;Target</a>.
            </p>
        </article>
    </main>
    <aside class="sidebar"><a href="/archive">Archive</a></aside>
</body>
</html>`;

/**
 * No link to the target anywhere. Expected: found false, error null, and a
 * message that says we could not see it rather than that it is not there.
 */
export const FIXTURE_NO_LINK = `<!doctype html>
<html lang="en">
<head><title>Nothing to see</title></head>
<body>
    <header><nav><a href="/">Home</a></nav></header>
    <main>
        <article>
            <h1>Nothing to see</h1>
            <p>We link to <a href="https://some-other-site.com/post">someone else</a> instead.</p>
        </article>
    </main>
    <footer><a href="/privacy">Privacy</a></footer>
</body>
</html>`;
