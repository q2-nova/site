# Contributing to the Q2 Nova site

Fixes and improvements are welcome as GitHub issues and pull requests. For
a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening an
issue.

## Change and check the site

Edit the pages in `dist/` and preview them with:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

The embedded player is generated from a q2-player build; the [simulator
guide](simulator/README.md) covers refreshing it and checking the tour.

## What a pull request must pass

The **Check site links** workflow runs on every pull request and push to
`main`. It checks every page in `dist/`, the files and fragments it links,
and its external links as a signed-out visitor. The [README](README.md#check-site-links)
gives the command to run it locally.

The site is published from `main` by a manual run of **Publish site to
GitHub Pages**, which repeats the link check first. Pull requests do not
publish.

## License

Bundled music, fonts and photographs keep the terms and credits listed
beside them.
