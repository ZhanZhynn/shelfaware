# QueryTransactionDetails

**Method:** GET
**Path:** /finance/transaction/details/get
**Authorization Required**

**Description:** API to query seller transaction details within specific date range.

## Service Endpoints

| Region | Endpoint |
| --- | --- |
| Vietnam | https://api.lazada.vn/rest |
| Singapore | https://api.lazada.sg/rest |
| Philippines | https://api.lazada.com.ph/rest |
| Malaysia | https://api.lazada.com.my/rest |
| Thailand | https://api.lazada.co.th/rest |
| Indonesia | https://api.lazada.co.id/rest |

## Common Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| app_key | String | Yes | Unique app ID issued by LAZADA Open Platform console when you apply for an app category |
| timestamp | String | Yes | The time stamp of the request e.g. 1517820392000 (which translates to 5 February 2018 08:46:32) with less than 7200s difference from UTC time |
| access_token | String | Yes | API interface call credentials |
| sign_method | String | Yes | The HMAC hash algorithm you are using to calculate your signature |
| sign | String | Yes | Part of the authentication process that is used for identifying and verifying who is sending a request (click [here](https://open.lazada.com/apps/doc/doc?nodeId=10450&docId=108068) for details) |

## Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| offset | String | No | Number of transaction lines to skip at the beginning of the list. |
| trans_type | String | No | Transaction type ID. |
| trade_order_id | String | No | Order ID. |
| limit | String | No | Number of lines of transactions to be extracted. The supported maximum number is 500. |
| start_time | String | Yes | Starting date when transactions need to be extracted. |
| end_time | String | Yes | Ending date when transactions need to be extracted. |
| trade_order_line_id | String | No | Order Item ID. |

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| data | Object[] | Response body |
| fee_type | String | Transaction type ID. |
| details | String | Transaction details |
| seller_sku | String | The seller SKU |
| lazada_sku | String | The Lazada SKU |
| amount | String | Total transaction value |
| VAT_in_amount | String | The VAT in amount |
| WHT_amount | String | The WHT amount |
| WHT_included_in_amount | String | The WHT included in amount or not |
| statement | String | Statement ID |
| paid_status | String | Yes / No |
| order_no | String | Order ID |
| orderItem_no | String | Order item number |
| orderItem_status | String | The order item status |
| shipping_provider | String | The shipping provider |
| shipping_speed | String | The shipping speed |
| shipment_type | String | The shipment type |
| reference | String | The Order Item ID (the Sub-order ID of "Order ID" parameter) |
| comment | String | Comments by regional finance team |
| payment_ref_id | String | Payment reference ID from bank or other payment provider |
| fee_name | String | feeName |
| transaction_date | String | Date of the transaction |
| transaction_type | String | Transaction type or fee name |
| transaction_number | String | Unique ID of the transaction in the format "Seller code- xxxxxxx" |

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| 1000012 | endTime - startTime must should be less than 180 days | endTime - startTime must should be less than 180 days |
| 1000014 | Can not find that transactionType | transaction type invalid |
| 1000012 | endTime - startTime must should be less than 180 days | Please make sure that the timeframe of your inquiry is within 180 days. |

## Code Example

### JAVA
```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/finance/transaction/details/get");
request.setHttpMethod("GET");
request.addApiParameter("offset", "0");
request.addApiParameter("trans_type", "-1");
request.addApiParameter("trade_order_id", "123123213213");
request.addApiParameter("limit", "100");
request.addApiParameter("start_time", "2021-01-01");
request.addApiParameter("end_time", "2021-01-05");
request.addApiParameter("trade_order_line_id", "45645674566");
LazopResponse response = client.execute(request, accessToken);
System.out.println(response.getBody());
Thread.sleep(10);
```

### Response
```json
{
  "code": "0",
  "data": [
    {
      "order_no": "123445666666",
      "transaction_date": "17 May 2016",
      "amount": "-0.62",
      "paid_status": "Not paid",
      "shipping_provider": "LEX",
      "WHT_included_in_amount": "Yes",
      "payment_ref_id": "paymentRefId",
      "lazada_sku": "Item test -123",
      "fee_type": "13",
      "transaction_type": "Payment Fee",
      "orderItem_no": "1666666",
      "orderItem_status": "orderItemStatus",
      "reference": "1340",
      "fee_name": "feeName",
      "shipping_speed": "shippingSpeed",
      "WHT_amount": "0.0112",
      "transaction_number": "SG103EF-1P9VK1A",
      "seller_sku": "sellerSKU",
      "statement": "11 May 2016 - 17 May 2016",
      "details": "details",
      "comment": "comment",
      "VAT_in_amount": "0.0672",
      "shipment_type": "Dropshipping"
    }
  ],
  "request_id": "0ba2887315178178017221014"
}
```
