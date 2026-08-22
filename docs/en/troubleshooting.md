# Troubleshooting

When the panel is running but something is not.



## The product is not listed

The bridge resolves `codex` and `claude` from the `PATH` of the **process running
the Harness**, which is not necessarily the `PATH` of the terminal you tested in.
Under a per-shell version manager (fnm, nvm, asdf) a product installed for one
Node version is invisible to a Harness started under another, and the panel
correctly reports `not-installed` for something you can run by hand.

```sh
# macOS, Linux — read the running Harness process's PATH
ps eww -p "$(pgrep -f 'dsh web' | head -1)" | tr ' ' '\n' | grep '^PATH='

# then start it from a shell that resolves the product
PATH="$PATH:/path/to/product/bin" dsh --profile web
```

The panel shows this hint inline next to any `not-installed` product.

## The product is installed but not ready

Run its `--version` in the shell that starts the Harness and compare with
[compatibility.md](compatibility.md). The panel names both the installed
version and the admitted range. Keep `allowExperimentalVersions` off unless you
have validated the protocol yourself.

## The browser asks me to authenticate

There is no login button by design. Log in with the product's normal command in a
terminal on the Host, then press Refresh — which re-probes both products, so no
profile restart is needed.

More in [Operations](operations.md).
