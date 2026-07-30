# QueryLogisticsFeeDetail

**Method:** GET/POST
**Path:** /lbs/slb/queryLogisticsFeeDetail
**Authorization Required**

**Description:** Api is provided for finance and seller to query logistics fee details from slb.

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
| seller_id | String | Yes | identity of seller which should not be blank |
| request_type | String | Yes | type of request which is used to distinguish different systems(e.g. OPEN_API) |
| trade_order_id | String | No | identity of trade order |
| trade_order_line_id | String | No | item identity of trade order |
| fee_type | String | No | type of logistics fee |
| biz_flow_type | String | No | corresponding settlement scenario of request(e.g. LAZADA, LAZADA_3PV, default biz flow type is LAZADA) |
| bill_start_time | Number | No | timestamp of the time that bill started |
| bill_end_time | Number | No | timestamp of the time that bill ended |
| page_no | Number | No | number of page which default 1 |
| page_size | Number | No | size of page which default 20 |
| total_records | Number | No | total records that page included |

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| data | Object[] | response body |
| statement_period | String | statement period |
| amount | Object | amount of the logistics fee that is posted to seller |
| tax_in_amount | Object | tax of the logistics fee that is posted to seller |
| trade_order_id | String | identity of trade order |
| seller_short_code | String | short code of seller |
| seller_id | String | identity of seller |
| fee_code | String | code of the logistics fee |
| fee_name | String | name of the logistics fee |
| fee_creation_date | Object | zone time when the logistics fee created |
| order_info | Object | information of order level |
| order_item_status | String | status of order item |
| order_creation_date | Object | zone time when the order created |
| statement_id | String | statement number |
| tenant_id | String | identity of tenant |
| currency | String | currency |
| package_info | Object | information of package level |
| billing_date | Object | zone time of billing |
| destination_address | String | code of destination address |
| origin_address | String | code of original address |
| package_chargeable_weight | String | package chargeable weight in kilogram |
| delivery_date | Object | zone time when the package delivered |
| tracking_number | String | tracking number of parcel |
| sku_info | Object | information of stock keeping unit |
| lazada_sku | String | unique product code of Lazada |
| item_details | String | information of order item level in details |
| seller_sku | String | unique product code of seller |
| trade_order_line_id | String | item identity of trade order |
| success | Boolean | response is success or not |
| remark | String | remark of response |

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| No Data | | |

## Code Example

### JAVA
```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/lbs/slb/queryLogisticsFeeDetail");
request.addApiParameter("seller_id", "1002");
request.addApiParameter("request_type", "OPEN_API");
request.addApiParameter("trade_order_id", "9432987348");
request.addApiParameter("trade_order_line_id", "9432997348");
request.addApiParameter("fee_type", "COD");
request.addApiParameter("biz_flow_type", "LAZADA");
request.addApiParameter("bill_start_time", "1642003200000");
request.addApiParameter("bill_end_time", "1642003200000");
request.addApiParameter("page_no", "1");
request.addApiParameter("page_size", "10");
request.addApiParameter("total_records", "1000");
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
      "tenant_id": "LAZADA_SG",
      "amount": {},
      "sku_info": {
        "item_details": "仓发商品",
        "seller_sku": "9cfa3cab-10f0-44eb-a5e3-302e81fd5ba7",
        "lazada_sku": "2630611102_SGAMZ-16733748056"
      },
      "seller_short_code": "SG101BB",
      "trade_order_id": "91293602900002",
      "fee_creation_date": {
        "offset": {
          "total_seconds": "28800",
          "rules": {
            "fixed_offset": "true"
          },
          "id": "+08:00"
        },
        "year": "2023",
        "day_of_year": "12",
        "nano": "799000000",
        "chronology": {
          "calendar_type": "iso8601",
          "id": "ISO"
        },
        "month_value": "1",
        "day_of_month": "12",
        "minute": "0",
        "second": "14",
        "month": "JANUARY",
        "hour": "17",
        "zone": {
          "rules": {
            "fixed_offset": "true"
          },
          "id": "GMT+08:00"
        },
        "day_of_week": "THURSDAY"
      },
      "trade_order_line_id": "91293603000002",
      "statement_id": "SG101BB-2023-0112",
      "order_info": {
        "order_item_status": "CONFIRMED",
        "order_creation_date": {
          "offset": "null",
          "year": "2023",
          "day_of_year": "12",
          "nano": "530000000",
          "chronology": "null",
          "month_value": "1",
          "day_of_month": "12",
          "minute": "26",
          "second": "57",
          "month": "JANUARY",
          "hour": "16",
          "zone": {
            "rules": {
              "fixed_offset": "true"
            },
            "id": "GMT+08:00"
          },
          "day_of_week": "THURSDAY"
        }
      },
      "fee_name": "Shipping Fee  Paid by Seller",
      "fee_code": "shippingFeeChargedByLazada",
      "currency": "SGD",
      "package_info": {
        "delivery_date": {
          "offset": "null",
          "year": "2023",
          "day_of_year": "12",
          "nano": "191000000",
          "chronology": "null",
          "month_value": "1",
          "day_of_month": "12",
          "minute": "58",
          "second": "16",
          "month": "JANUARY",
          "hour": "16",
          "zone": {
            "rules": {
              "fixed_offset": "true"
            },
            "id": "GMT+08:00"
          },
          "day_of_week": "THURSDAY"
        },
        "destination_address": "singapore",
        "origin_address": "singapore",
        "tracking_number": "LK000",
        "billing_date": {
          "offset": "null",
          "year": "2023",
          "day_of_year": "12",
          "nano": "211000000",
          "chronology": "null",
          "month_value": "1",
          "day_of_month": "12",
          "minute": "59",
          "second": "35",
          "month": "JANUARY",
          "hour": "16",
          "zone": {
            "rules": {
              "fixed_offset": "true"
            },
            "id": "GMT+08:00"
          },
          "day_of_week": "THURSDAY"
        },
        "package_chargeable_weight": "3.07"
      },
      "tax_in_amount": {},
      "seller_id": "213",
      "statement_period": "2023-01-12 - 2023-01-12"
    }
  ],
  "success": "true",
  "remark": "LEL",
  "request_id": "0ba2887315178178017221014"
}
```
