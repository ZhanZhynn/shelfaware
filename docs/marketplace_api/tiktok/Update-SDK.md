# Update SDK

# What this page covers
Use this page when you have already integrated a TikTok Shop SDK and need to refresh it because your app, API access scopes, API versions, or the SDK framework has changed.
For the first-time SDK download flow, go to [Download SDK](https://partner.tiktokshop.com/docv2/page/download-sdk). To reduce duplicated instructions, keep the split as follows:
| Page | Use it for |
| --- | --- |
| [Download SDK](https://partner.tiktokshop.com/docv2/page/download-sdk) | Find the SDK download page, select a language, and download the SDK for first-time integration. |
| Update SDK | Understand when a newer SDK appears, how to trigger an update check, what compatibility means, and how to migrate your existing project. |
# When an SDK update is generated
The SDK package shown for your app can change when any of the following changes apply to your effective app:

* API access scopes are added to or removed from your app.
* APIs are added, removed, upgraded, or sunset within your app's API access scope collection.
* The SDK framework is upgraded.
* Supported language versions are upgraded.

TikTok Shop sends SDK update notifications through [TikTok Shop Message Center](https://partner.tiktokshop.com/message/list).
[Image: TikTok Shop Message Center SDK update notification](https://sf16-sg.tiktokcdn.com/obj/eden-sg/jvK_ylwvslclK_JWZ[[/ljhwZthlaukjlkulzlp/Developer_Guide/TTSPC_API_SDK/message_center.png)
# Find the update entry
To check for an updated SDK, open the same SDK download page you used for the original SDK:

1. Go to Partner Center.
2. Open the console page for the app whose SDK you want to update.
3. Open the SDK download page described in [Download SDK](https://partner.tiktokshop.com/docv2/page/download-sdk).
4. Check the SDK generation time, SDK version, supported language, and available API scope/API set.
5. If you need the latest generated package, download the SDK again from this page.

The `check for updates` button is on the SDK download page. Use it when you have just changed scopes, app configuration, API access, or language requirements and do not want to wait for the next scheduled SDK generation.
[Image: Check for updates button on the SDK download page](https://sf16-sg.tiktokcdn.com/obj/eden-sg/jvK_ylwvslclK_JWZ[[/ljhwZthlaukjlkulzlp/Developer_Guide/TTSPC_API_SDK/check_for_updates.png)
# Daily generation and manual check
SDKs are generated on a daily basis. The manual `check for updates` button requests an earlier refresh for the app and language shown on the download page.
After clicking `check for updates`:

* Wait for the SDK page to show an updated generation time, package version, or download package.
* If there are no effective changes to scopes, API access, API versions, SDK framework, or supported language versions, the generated SDK may stay the same.
* If generation is still in progress, refresh the SDK download page later or check Message Center for update notifications.
* The version or generated time shown on the download page is the source of truth for the package you should download.

# Compatibility and API retirement
TikTok Shop aims to keep new SDK versions backward compatible, but compatibility depends on the API versions and scopes your app uses.
Use the following rules when assessing an SDK update:
| Change type | What to expect | What you should do |
| --- | --- | --- |
| Non-breaking SDK or API change | Existing SDK calls usually continue to work. New methods or fields may be added. | Update the SDK, run build/tests, and smoke test critical flows. |
| New API version with breaking changes | Breaking API changes are introduced through a new API version. Older versions may remain available for a limited period. | Read the API reference and [API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning) notes before changing your code to a newer API version. |
| API version retirement | A prior API version remains available for at least 2 months after a new version is released. Retirement is announced in the [changelog](https://partner.tiktokshop.com/docv2/changelog) at least 2 months before permanent retirement. | Plan migration before the retirement date. If you call a retired or invalid API version, the API can return `36009014` with a message that the version name is invalid. |
| Scope or app access change | SDK methods can appear or disappear based on the effective app scope/API set. | Confirm your app scopes, update seller authorization if new scopes require reauthorization, then download the regenerated SDK. |

Before updating production traffic, review:

* [Changelog](https://partner.tiktokshop.com/docv2/changelog) for release, breaking change, and retirement notices.
* [API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning) for version naming, selection, and retirement behavior.
* The API reference page for each endpoint you call, including the version dropdown and migration notes.

# Migration steps
Follow these steps whenever you download a newer SDK package:

1. Review the SDK download page and changelog. Confirm what changed: scope set, API version, SDK framework, or language support.
2. Download the SDK package for the same language used by your project.
3. Create a separate branch and replace the generated SDK folder, local module, or package in that branch.
4. Update dependency references to the new SDK package or local module path.
5. Reinstall or rebuild dependencies for your language.
6. Compile the project and fix import, package, class, or method changes.
7. Run unit tests and integration tests for the API domains your app uses.
8. Smoke test authorization, token refresh, request signing, and one core API call per updated API domain.
9. Deploy gradually and monitor API errors, especially invalid version, permission, scope, and signature errors.

# Language-specific update notes
| Language | Typical update action |
| --- | --- |
| Java | Replace the generated SDK module or JAR, update the dependency version or local path, then run `mvn clean test`, `mvn install`, or your Gradle build command. |
| Go | Replace the generated SDK module, update the module path or version if needed, then run `go mod tidy`, `go test ./...`, and `go build ./...`. |
| Node.js | Replace the generated SDK folder or package, keep your application code and config files, then run `npm install`, `yarn install`, or `pnpm install`, followed by your TypeScript build and tests. |

If your language-specific integration guide still shows a placeholder version such as `1.0.0`, do not assume it is the latest SDK version. Use the version or generated timestamp shown on the SDK download page for your app.
# Scope and authorization checks
An SDK update does not automatically grant new API permissions.
If the update includes new scopes or APIs:

* Confirm the app has the required API access scopes in Partner Center.
* If new seller permissions are required, ask sellers to authorize or reauthorize the app as needed.
* Confirm that the regenerated SDK contains the API methods you expect.
* Test with a development shop or sandbox flow before using the updated SDK in production.

# Related links
| Link | Use it for |
| --- | --- |
| [Download SDK](https://partner.tiktokshop.com/docv2/page/download-sdk) | Download the SDK package from the SDK download page. |
| [API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning) | Understand API version naming, version selection, and retirement behavior. |
| [Changelog](https://partner.tiktokshop.com/docv2/changelog) | Track API changes, breaking changes, and retirement notices. |
| [TTS API overview](https://partner.tiktokshop.com/docv2/page/overview) | Return to the API overview and navigation. |

<div style="text-align: center"><img src="https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/d650c57863e9440c86355e51dc41ca19~tplv-k9wyc2ijk0-image.image" width="1280px" /></div>

<div style="text-align: center"><img src="https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/95dc1a7287ae4ef6bb4471ac1877ee59~tplv-k9wyc2ijk0-image.image" width="1082px" /></div>

