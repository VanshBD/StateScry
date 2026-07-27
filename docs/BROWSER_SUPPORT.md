# Browser and platform support

StateScry uses Playwright's Chromium, Firefox, and WebKit engines. The engine matrix is
verified on Ubuntu for every push and pull request. Clean source and package installation
are designed for and configured on Windows, Ubuntu Linux, and macOS; their workflow uses
Chromium as the common smoke engine.

Local Firefox and WebKit are supported wherever the matching Playwright release supports
the host. Platform-specific browser dependencies must be installed with Playwright. A
browser unavailable on a particular runner is a documented platform constraint, not a
silent pass. Current local Windows evidence exercises all three engines.
