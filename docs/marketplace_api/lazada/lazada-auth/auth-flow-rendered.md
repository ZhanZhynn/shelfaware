- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fdoc%3FnodeId%3D10533%26docId%3D108260) [Sign up](https://open.lazada.com/apps/user/register)


AI Assistant![](https://ae-pic-a1.aliexpress-media.com/kf/S00d31076895a492997d996fd48b505505.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S1df43fd5905043cdaafec6c8bdeb090c5.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S7813d62b8ecf4c1991c806f44352a7daV.png)

- Overview

- Quick Start Guide



  - [Getting started](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108130)

  - [Registration and Authorization process for newly registered ISVs](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=121098)

  - [Become a developer](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108001)

  - [Register an application](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108002)

  - [Retrieve App Key and App Secret](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108055)

  - [Request API permission](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108131)

  - [Seller authorization introduction](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108260)

  - [Configure seller authorization](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108056)

  - [Start development](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=108132)

  - [Redmart api interface guide](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=121567)

  - [The Process of Creating Test Order](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=121061)

  - [Service market entry operation guidelines](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=121772)

  - [Lazada服务市场入驻操作指引](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=121773)
- API Best Practice

- Push Mechanism(WebHook) Application

- API Reference

- Advanced Tasks

- Developer's Guide

- Security Center

- Terms and Agreement

- FAQ


## Seller authorization introduction

Last UpdatedMar 4,2026

Reads22293

If your application needs to access the business data of Lazada sellers (like product and order information) through Lazada Open Platform, you need to get the authorization from sellers, that is, the “Access Token” required for accessing the sellers’ data. You need to guide the sellers to complete the flow of “using Lazada seller account to log in and authorize the application”. This process uses the international OAuth2.0 standard protocol for user authentication and authorization.

Lazada Open Platform operates on a “code-for-token” model and employs three distinct authorization policies.

Note: Before attempting the authorization process, please ensure you have completed the creation of your app.

# **Service address**

|     |     |
| --- | --- |
| Country | Service address |
| all countries (SG/MY/TH/VN/ID/PH) | https://auth.lazada.com/ |

# **Authorization URL**

https://auth.lazada.com/oauth/authorize?response\_type=code&force\_auth=true&redirect\_uri=${app call back url}&client\_id=${appkey}

This link is used to initiate the seller authorization process.

Developers need to replace “${app callback url}” in the URL with the callback address used to receive the authorization code. After successful authorization, the seller's browser will be redirected and access your callback address using the GET method. Please note that this callback address must exactly match the callback address configured in your app. Otherwise, the error “Redirect uri does not match the callback URL of the app” will occur.

Then, developers need to replace “${appkey}” with the APP KEY of the app you created. Ensure that the APP KEY you replace matches the callback URL; otherwise, the error “Redirect uri does not match the callback URL of the APP” will occur.

## **Parameters**

|     |     |     |     |
| --- | --- | --- | --- |
| Parameter name | Required | Demo | Description |
| client\_id | Yes | 101406 | The APPKEY created in the [APP console](https://isvconsole.lazada.com/apps/console/apps). |
| redirect\_uri | Yes | https://lazada.com | This redirect URL is used to receive the authorization code. The redirect will be initiated after the seller completes the authorization process. |
| response\_type | Yes | code | Authorization type, fixed value “code”. |
| state | No | Custom value,123456 | This field is a custom field. Its value will be sent to the redirect URL along with the authorization code upon successful authorization. |

# **Overview of Authorization Policies**

The open platform offers three distinct authorization strategies, each adding an additional step to the standard “code for token” process.

After creating your app, navigate to the App Console -> Development -> App Management page. Click “Manage” to access the details page for further information.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(15)_1772502765397__DDkA.png)

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(16)_1772502808754__BriC.png)

## **Allow binding user to authorize（search key: ABA）**

This authorization policy typically appears in apps created by accounts with a partner type of “Self-Developed.” This policy indicates that the developer's app is exclusively for use within the enterprise/group's internal Lazada stores or designated partner stores (not exceeding 60), subject to whitelist restrictions.

Please use your browser's search function (CTRL + F) to search for “ABA” to view the complete authorization process.

## **Allow login user to authorize（search key: ALA）**

This authorization policy typically appears in apps created by developer accounts with a business-to-business partner type. This policy indicates that your app can proceed directly with the seller authorization process without any prerequisites.

Please use your browser's search function (CTRL + F) to search for “ALA” to view the complete authorization process.

Note: Under the current policy (12.25.2025), this authorization policy will only appear in apps in test status. Once your app applies for release, this policy may be updated to “Allow subscribers to authorize” and will not support rollback.

## **Allow subscribers to authorize（search key: ASA）**

This authorization policy typically appears after an app created by a developer account with a “Enterprise Commercial” partner type goes online. This policy indicates that your app has been switched to subscription authorization. Details are as follows:

**Local stores**: Sellers must subscribe to the corresponding service for the app in the Lazada Service Market before completing authorization.

**Cross-border stores**: Please refer to the authorization process for “Allow login user to authorize”. Currently, the Lazada Service Marketplace has not yet enabled subscription functionality for cross-border stores.

Please use your browser's search function (CTRL + F) to search for “ASA” to view the complete authorization process.

# Basic Authorization Process (ALA/ASA - Cross-Border Sellers Only)

This process will introduce the basic authorization flow (corresponding to the policy “Allow login user to authorize”). The other two authorization policies are based on this flow with additional prerequisite configuration requirements.

## Authorization Flowchart

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_______________________________________________________________________Seller%20authorization%20introduction%20-%20%E8%8B%B1%E6%96%87-%E6%B5%81%E7%A8%8B%E5%9B%BE_1772502919980__TzyZ.jpg)

## **Authorization Process Example**

1. Applicable Authorization Policies: Allow login user to authorize, Allow subscribers to authorize (Cross-border sellers only)
2. Sample test information: APP KEY - 100132 Callback URL - https://www.lazada.com

### **1、** Visit the authorized URL

Replace the placeholder in the authorization URL with the APP information from the test data as shown in the example. This will generate the following URL, which can then be accessed:

https://auth.lazada.com/oauth/authorize?response\_type=code&force\_auth=true&redirect\_uri=https://www.lazada.com&client\_id=100132

### Select Store Site

After accessing the first-step concatenated authorization URL, the seller will be directed to the authorization page.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(17)_1772503002231__aWPV.png)

On the authorization page, sellers must select the appropriate Site based on their store type and country, then click "Use Seller Login".

Local stores or cross-border stores wishing to authorize only a single site can choose from the following options: Singapore, Malaysia, Indonesia, Philippines, Thailand, Vietnam;

For cross-border stores seeking a single authorization applicable to all sites, select Crossborder;

Choice sellers, please select these options: Lazada Choice - SG\\MY\\ID\\PH\\TH\\VN

### **2、** Seller Center Login

After clicking “User Seller Login” in the second step, the system will redirect to the corresponding seller center login page based on the seller's selected site. Sellers must complete the login process on this page. Upon successful login, the page will redirect again to the authorization page.

Note:

QR code login is currently unavailable for authorization.

If sellers cannot log in on this page, they should verify that their password is correct or reset it. The login verification on this page is unrelated to the Open Platform.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(18)_1772503029396__8MIY.png)

### **3、** Complete the authorization

After completing the third step of logging in, the seller's browser will be redirected back to the authorization page. Please have the seller verify that the email address listed under My Account matches the login email for the store requiring authorization.

If the account is incorrect, please have the seller click Switch to return to Seller Center and log out there, or open a new incognito mode tab and restart the authorization process from the beginning.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(19)_1772503066899__CeiO.png)

### **4、** Receive the authorization code and generate an access token

After the seller clicks “Authorize” on the fourth step page, their browser will be redirected to the URL specified in the redirect\_uri field, along with the code parameter.

https://www.lazada.com/?code=0\_100132\_Cl3VmMr6W6YC6cx6swxFAZ0l825

After receiving the authorization code, developers must call the [GenerateAccessToken API](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2Fcreate) within half an hour to exchange the authorization code for an Access Token used to call the Lazada Open API.

#### **Request Demo**

PlainBashC++C#CSSDiffHTML/XMLJavaJavascriptMarkdownPHPPythonRubySQL

https://auth.lazada.com/rest/auth/token/create?code=0\_100132\_Cl3VmMr6W6YC6cx6swxFAZ0l825&app\_key=100132&sign\_method=sha256&timestamp=1767595695482&sign=3F178EC4420269D66298A662551246D7669E84314A38E00D278A584EBF5EA079

#### **Response Demo**

PlainBashC++C#CSSDiffHTML/XMLJavaJavascriptMarkdownPHPPythonRubySQL

{

"access\_token": "50000201f12dgccvfLzTimgL1c1c4dd8h0irs9DWCORDQqXRlsvWgpDt5x4Fwy",

"country": "sg",

"refresh\_token": "50001201e12pmXdgResRzjif112e3a46Kl0eqskC0iRRhLQXprmWX5QElsqQOK",

"account\_platform": "seller\_center",

"refresh\_expires\_in": 4320000,

"country\_user\_info": \[\
\
{\
\
"country": "sg",\
\
"user\_id": "1152180742",\
\
"seller\_id": "1152180742",\
\
"short\_code": "SGLYT0OS"\
\
}\
\
\],

"expires\_in": 864000,

"account": "LzdOp\_SG\_test@163.com",

"code": "0",

"request\_id": "212a6a5a17675956955215662",

"\_trace\_id\_": "213bd36917675956955192683e1e39"

}

### **5、** Manage Access Token and Refresh Token

After successfully calling the GenerateAccessToken API, developers will receive the following response information:

|     |     |     |     |
| --- | --- | --- | --- |
| Parameter name | Demo | Enum | Description |
| access\_token | 50000201f12dgccvfLzTimgL1c1c4dd8h0irs9DWCORDQqXRlsvWgpDt5x4Fwy | N/A | The token used to call the Lazada Open API; each access token corresponds to a single store and can only query or update information for that specific store.<br>Note: Access tokens generated by different APPKEYS cannot be used interchangeably. |
| expires\_in | 864000 | N/A | The number of seconds remaining until the current access token expires. For example, 86,400 seconds equates to 10 days. |
| refresh\_token | 50001201e12pmXdgResRzjif112e3a46Kl0eqskC0iRRhLQXprmWX5QElsqQOK | N/A | When the corresponding access token expires, developers can use the refresh token to call the [RefreshAccessToken API](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2Frefresh) to obtain a new access token. |
| refresh\_expires\_in | 4320000 | N/A | The remaining seconds until the current refresh token expires. For example, 4320000 seconds equates to 50 days. After 50 days, the refresh token will expire, and a new refresh token can only be obtained by completing the authorization process again.<br>Note: The refresh token cannot be refreshed using the RefreshAccessToken API. |
| country | sg | sg: Singapore<br>my: Malaysia<br>ph: Philippines<br>th: Thailand<br>id: Indonesia<br>vn: Vietnam<br>cb: Cross-border | The store country type selected by the seller during authorization. |
| account\_platform | seller\_center | seller\_center | N/A |
| country\_user\_info | object arry | N/A | Specific details of the authorized seller store, including the countries where the access token granted in this authorization is valid, the seller ID, and the seller short code.<br>Note: Cross-border sellers may have stores in multiple countries. If a cross-border seller selects “Cross-border” during authorization, the generated access token can be used across all country stores under that object without needing to generate it multiple times. |
| country\_user\_info.country | sg | sg: Singapore<br>my: Malaysia<br>ph: Philippines<br>th: Thailand<br>id: Indonesia<br>vn: Vietnam | The country corresponding to the current object's store. |
| country\_user\_info.user\_id | 1152180742 | N/A | Authorized account ID for the current country store (not visible in Seller Center). |
| country\_user\_info.seller\_id | 1152180742 | N/A | The seller ID of the store in the current country. |
| country\_user\_info.short\_code | SGLYT0OS | N/A | The store's short code in the current country. |
| account | LzdOp\_SG\_test@163.com | N/A | The email address used by the seller during authorization. |

Developers must retain the above information and use the [RefreshAccessToken API](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2Frefresh) to obtain a new access token before the old access token expires.

Remind sellers to repeat the authorization process before the old refresh\_token expires to obtain a new refresh\_token and access token.

# Seller Authorization Whitelist Type App Authorization Process (ABA)

## **1、** Add Authorized Seller Whitelist

This seller authorization process applies to apps created by developer accounts where the partner type was selected as “Enterprise/Individual Self-Developed” during basic information setup. Apps created by such developer accounts predominantly follow the “Allow binding user to authorize” authorization strategy. An “Authorized Seller Whitelist” option will be added at the very bottom of the app's details page in the [App Console](https://isvconsole.lazada.com/apps/console/apps).

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(21)_1772503228598__DqmY.png)

Click “Add” to enter the addition module and fill in the seller's relevant information.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(22)_1772503247564__TjXS.png)

1. Seller ID

Please enter the ID found in the “short code” field at the top left of the Seller Center -> Settings page.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(23)_1772503268517__Ygpq.png)

1. Seller Email & Password

Please enter the email address and password used to log in to the corresponding store in Seller Center.

1. Country

For cross-border stores, please select China or add all six sites to the whitelist. Non-cross-border stores should select the option corresponding to their store's country of origin.

## **2、** Complete the authorization process

After adding the seller to the whitelist, the seller can access the app's authorization URL and complete the authorization process following the basic authorization flow.

# Subscription Authorization App Authorization Process **（ASA）**

This authorization type will only appear in online apps created by developer accounts with the partner type set to Enterprise Commercial.

## Notes

1. The authorization policy for apps in testing state created by enterprises commercial developer accounts is "Allow login user to authorize", which will only be updated to "Allow subscribers to authorize" after the app goes online;
2. After the app is updated to the online status, please refer to Step 4 of [this document](https://open.lazada.com/apps/doc/doc?nodeId=10533&docId=121773) to begin publishing the app on the service market.
3. For the authorization process of cross-border stores, please refer to the “Basic Authorization Process.” Subscription authorization is currently only available to local sellers.
4. Refresh tokens generated from subscription authorizations by local sellers are unusable because the access token's validity period will be tied to the subscription's validity period in the service marketplace, rather than expiring after a fixed time.

## Subscription Process

### **1、** Visit the Service Market Subscription Page

After developers complete the qualification verification for the service marketplace and successfully publish their service offerings in the corresponding countries, they can access each country's service marketplace and conduct searches.

#### Service Market URL

Vietnam

[https://marketplace.lazada.vn](https://marketplace.lazada.vn/)

Singapore

[https://marketplace.lazada.sg](https://marketplace.lazada.sg/)

Philippines

[https://marketplace.lazada.com.ph](https://marketplace.lazada.com.ph/)

Malaysia

[https://marketplace.lazada.com.my](https://marketplace.lazada.com.my/)

Thailand

[https://marketplace.lazada.co.th](https://marketplace.lazada.co.th/)

Indonesia

[https://marketplace.lazada.co.id](https://marketplace.lazada.co.id/)

### **2、** Search and enter the details page to subscribe

After entering the page, select the service version and validity period, then click “Authorized use” or “Buy it now” to subscribe.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(24)_1772503310560__OlDI.png)

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(25)_1772503326356__s6PR.png)

Click “Confirm” to complete subscription.

Note: If the seller has selected the paid version, payment must be made before subscribing.

### **3、** Complete the authorization

After clicking “Confirm” or completing payment, you will be directed to this page. Sellers can follow the prompts here to click “Authorized use of services” and proceed to the service page for authorization.

Alternatively, authorization can be completed through the basic authorization process.

Note: If a local store seller attempts the basic authorization process without subscribing, they will be intercepted at the final authorization step and redirected to your service subscription page. If your app has not yet been listed on the service marketplace, an error will occur.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(26)_1772503349467__gZm2.png)

# **FAQ**

**Q1、** After logging into Seller Center, a “Missing parameter” error appears.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(27)_1772503478074__Z1k8.png)

A1、This error typically occurs in the browser during the initial authorization process. If this error appears, please instruct the seller not to close the browser. Instead, have them revisit the authorization link “auth.lazada......” to complete the authorization process by re-authorizing.

**Q2、** Encountered a seller whitelist error during authorization.

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(28)_1772503499481__5tbG.png)

A2、This error occurs because the currently authorized seller store is not included in the corresponding app's seller whitelist. Please navigate to the App Management page in the App Console and add your seller to the authorized seller whitelist at the bottom of the page.

**Q3、** After authorizing the login in Seller Center, the system did not return to the authorization page but instead proceeded directly to Seller Center.

A3、This issue typically occurs when sellers have already logged into Seller Center before authorization or used QR code scanning instead of credentials for login. Therefore, the quickest solution is to have the seller open a new incognito browser window and complete authorization using their account credentials.

**Q4、Redirect uri does not match the callback url of the APP**

![](https://lazada-open-platform-public.oss-ap-southeast-1.aliyuncs.com/online/oss_image%20(29)_1772503521056__SMPR.png)

﻿﻿﻿﻿A4、This error occurs because the redirect\_uri in the authorization link does not match the callback URL configured for the app in the client\_id. Correcting the redirect\_uri will resolve this issue.

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS