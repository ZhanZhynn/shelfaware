- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Forder%252Fdocument%252Fget) [Sign up](https://open.lazada.com/apps/user/register)


AI Assistant![](https://ae-pic-a1.aliexpress-media.com/kf/S00d31076895a492997d996fd48b505505.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S1df43fd5905043cdaafec6c8bdeb090c5.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S7813d62b8ecf4c1991c806f44352a7daV.png)

- System API

- Seller API

- Product API

- Cross Boarder Product API

- Product Review API

- Store Decoration API

- Media Center API

- Flexicombo API

- Seller Voucher API

- Free Shipping API

- Early Bird Price API

- Order API



  - [GET\\
    \\
    GetDocument](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fdocument%2Fget)

  - [GET\\
    \\
    GetMultipleOrderItems](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fitems%2Fget)

  - [GET/POST\\
    \\
    GetOVOOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fovo%2Fget)

  - [GET\\
    \\
    GetOrder](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fget)

  - [GET\\
    \\
    GetOrderItems](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fitems%2Fget)

  - [GET\\
    \\
    GetOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget)

  - [GET\\
    \\
    OrderCancelValidate](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Fcancel%2Fvalidate)

  - [POST\\
    \\
    SetInvoiceNumber](https://open.lazada.com/apps/doc/api?path=%2Forder%2Finvoice_number%2Fset)
- Return and Refund API

- Fulfillment API

- Logistics API

- FirstMile Bigbag(only for CN)

- Finance API

- Membership API

- FBL API

- Instant Messaging API

- Lazada Logistics API

- E-Tickets API

- LazPay API

- Lazada Wallet Corporate Top-up API

- RedMart API

- Lazada DG API

- Sponsored Solutions API

- Service Market API

- Choice Customized API

- LazLike API

- LazLive API

- Logistics Station API

- LazCredit Risk API

- Content API

- Store Flash Sale API


Latest update2022-07-21 11:33:17

34260

GetDocument

GET

/order/document/get

Authorization Required

Description:Use this API to retrieve order-related documents, including invoices and shipping labels.

## Service Endpoints

| Region | Endpoint |
| --- | --- |
| Vietnam | https://api.lazada.vn/rest |
| Singapore | https://api.lazada.sg/rest |
| Philippines | https://api.lazada.com.ph/rest |
| Malaysia | https://api.lazada.com.my/rest |
| Thailand | https://api.lazada.co.th/rest |
| Indonesia | https://api.lazada.co.id/rest |

Did this chapter help you?

YesNo

## Common Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| app\_key | String | Yes | Unique app ID issued by LAZADA Open Platform console when you apply for an app category |
| timestamp | String | Yes | The time stamp of the request e.g. 1517820392000 (which translates to 5 February 2018 08:46:32) with less than 7200s difference from UTC time |
| access\_token | String | Yes | API interface call credentials |
| sign\_method | String | Yes | The HMAC hash algorithm you are using to calculate your signature |
| sign | String | Yes | Part of the authentication process that is used for identifying and verifying who is sending a request (click [here](https://open.lazada.com/apps/doc/doc?nodeId=10450&docId=108068) for details) |

Did this chapter help you?

YesNo

## Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| doc\_type | String | Yes | Document types, including 'invoice', 'shippingLabel', or 'carrierManifest'. Mandatory. |
| order\_item\_ids | String | Yes | Identifier of the order item for which the caller wants to get a document. Mandatory. |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| data | Object | response data |
| document | Object | document |
| file | String | To reconstruct the file, the data from the  node needs to be base64 decoded, and interpreted according to the mime\_type. |
| mime\_type | String | To reconstruct the file, the data from the  node needs to be base64 decoded, and interpreted according to the mime\_type. |
| document\_type | String | Document types, including 'invoice', 'shippingLabel', or 'carrierManifest'. |

Did this chapter help you?

YesNo

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| 20 | E020: "%s" Invalid Order Item IDs | The specified order item ID is not valid. |
| 21 | E021: OMS Api Error Occurred | Internal system error. |
| 32 | E032: Document type "%s" is not valid | The specified document type is not valid. |
| 34 | E034: Order Item must be packed. Please call SetStatusToReadyToShip before | The current status of the order item is not valid. |
| 35 | E035: "%s" was not found | The specified order item is not found. |
| 30012 | rts package not found | Order item ID status must be "packed" or "ready to ship" |
| 700040 | There are no packages that support printing! | Printing AWB is not supported for orders in Unpaid, pending, canceled status or SOF/DBS orders. |
| 700040 | There are no packages that support printing! | Printing AWB is not supported for orders in Unpaid, pending, canceled status or SOF/DBS orders. |
| 700040 | There are no packages that support printing! | Printing AWB is not supported for orders in Unpaid, pending, canceled status or SOF/DBS orders. |
| 700040 | There are no packages that support printing! | Printing AWB is not supported for orders in Unpaid, pending, canceled status or SOF/DBS orders. |
| 6 | For input string: "" | Make sure you enter an array and not a string in the order\_item\_ids parameter. |
| 50008 | ot support operation for sof order | SOF/DBS type orders do not support the call of this API to query Shipping label, this type of orders by the seller to contact the logistics, Lazada does not provide Shipping label. |

Did this chapter help you?

YesNo

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/order/document/get) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET

/order/document/get

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/order/document/get");
request.setHttpMethod("GET");
request.addApiParameter("doc_type", "shippingLabel");
request.addApiParameter("order_item_ids", "[279709, 279709]");
LazopResponse response = client.execute(request, accessToken);
System.out.println(response.getBody());
Thread.sleep(10);
```

Response

* * *

```json
{
  "code": "0",
  "data": {
    "document": {
      "file": "PHN0eWxlPnRlRrU3VRbUNDJyAvPjwvcD4K",
      "mime_type": "text/html",
      "document_type": "shippingLabel"
    }
  },
  "request_id": "0ba2887315178178017221014"
}
```

Please rate this article

Popular Articles

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS