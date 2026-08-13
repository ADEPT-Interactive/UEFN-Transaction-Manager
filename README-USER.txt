UEFN ENTITLEMENT MANAGER — USER RELEASE

1. Extract the entire ZIP file to a normal folder.
2. Open UEFNEntitlementManager-2.3.2.exe.
3. Select the project marked Open in UEFN, choose a recent project, or browse
   to its .uefnproject file.
4. Confirm Open project in UEM.

The release already contains the standalone app shell, frontend, bridge, Node
runtime, and dependencies. The manager itself runs in its embedded shell; links
you open are handed to Windows and attempt to use the system default browser.
Do not move or delete the dist or .runtime folders. No Node.js, npm,
or build installation is required.

The Windows Microsoft Edge WebView2 Runtime and .NET Framework 4.8 are required
as app runtimes. WebView2 is embedded in the manager; this is not the Edge
browser and no browser window is opened.

Python is not required to open UEM, generate Verse, or save it. Native PNG to
Texture2D importing is an optional editor feature. UEM installs its project
connector automatically when you link the project. From UEFN's palm-tree
Project menu, open Project Settings, scroll to Python Editor Scripting, and
enable its checkbox. UEM detects it immediately; no restart is needed. If UEFN is already open when the connector is first installed,
UEM attaches it automatically. Future desktop launches also attach importing
automatically. You do not need to run a Python file. UEM separately reports
whether UEFN is running, which project is open, and whether Python is connected.

After a confirmed import, a project-scoped preview is kept under
Content/.uem-icon-previews so the catalog can restore thumbnails after a
restart. New entitlements use a native placeholder texture until you import a
real icon; Save & Compile creates that placeholder first when necessary.

For the normal workflow, create an offer, save and compile the generated Verse,
place its generated creative device in the island, and connect Trigger devices
to the generated editable arrays. Button and mutator-zone arrays are optional
advanced bindings and remain disabled unless you enable them. Focused offer
displays can present selected offers together without selling them as a bundle.

For source access, development setup, contribution rules, and license terms,
use the source repository. The software is owned by AD3PT Interactive Inc.,
which also operates as ADEPT Interactive and ADEPT. The source-available
license does not allow unauthorized derivative releases, repackaging,
embedding, or redistribution. GitHub platform forks used for contribution do
not grant release or commercialization rights.
