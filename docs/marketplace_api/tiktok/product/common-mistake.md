# Common mistakes

When integrating with TikTok Shop Products APIs, it’s essential to understand the correct structure and usage of each parameter to ensure smooth API interactions. In this article, we highlight common mistakes developers make when calling the APIs, particularly for complex parameters, and provide guidance on how to avoid them.

# Sales Attributes
First, it’s important to understand what sales attributes are and their relationship to SKUs.
**Sales attributes** are variations specific to an SKU, such as size, color, and material, while an **SKU** represents a **unique** combination of these attributes, creating distinct versions of a product. For example, a sweater with color "Red" and material "Cotton" would be one SKU, while a sweater with color "Blue" and material "Wool" would be a different SKU.

This section focuses on how to avoid common mistakes when defining sales attributes during product listing through practical examples. 
> Note: The examples here use the "name" parameters, but the same principles apply when using the "id" parameters as well.

## Duplicated sales attributes in 1 SKU
Each SKU can only **define each sales attribute ID/name once**. In practical terms, this means an SKU can’t have two different colors at the same time. 
### Incorrect usage
Example: A sweater SKU can't be both red and blue at the same time.
```JSON
// Product
"skus": [
    { // SKU 1
      "sales_attributes": [ 
        { // variation A
          "name": "Color",    // duplicated value
          "value_name": "Red"
        },
        { // variation A
          "name": "Color",    // duplicated value
          "value_name": "Blue"
        }
      ]
    }
  ]
```

### Correct usage
Example 1: If you're representing different sweater colors, create separate SKUs for each color instead of assigning multiple values to a single attribute within one SKU.
```JSON
// Product
"skus": [
    { // SKU 1 - Red sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"
        }
      ]        
    { // added SKU 2 - Blue sweater
      "sales_attributes": [         
        { // variation A
          "name": "Color",
          "value_name": "Blue"
        }
      ]
    }
  ]
```


Example 2: If you're representing a sweater with multiple color elements, such as an outer color and an inner color, each should be defined as a separate sales attribute.
```JSON
// Product
"skus": [
    { // SKU 1 - Sweater with red on the outside and blue on the inside
      "sales_attributes": [ 
        { // variation A
          "name": "Outer Color",    // unique value
          "value_name": "Red"
        },
        { // variation B
          "name": "Inner Color",    // unique value
          "value_name": "Blue"
        }
      ]
    }
  ]
```


## Duplicated sales attribute values across SKUs
Each SKU must represent a **unique combination of sales attribute value ID/names.** In practical terms, this means you can't have two SKUs with the same combination of attributes and attribute values. For example, you can have two SKUs for red sweaters, but they must differ by another attribute, such as size or material.
### Incorrect usage - 1 attribute
Example: You can't have two SKUs for red sweaters.
```JSON
// Product
"skus": [
    { // SKU 1
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"    // duplicated value
        }
      ]
    },
    { // SKU 2
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"    // duplicated value
        }
      ]
    }    
  ]
```

### Correct usage - 1 attribute
Example: Set different colors, red and blue, for each sweater SKU.
```JSON
// Product
"skus": [
    { // SKU 1 - Red sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"    // unique value
        }
      ]
    },
    { // SKU 2 - Blue sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Blue"    // unique value
        }
      ]
    }    
  ]
```


### Incorrect usage - Multiple attributes
Example: You can't have two SKUs for red cotton sweaters.
```JSON
// Product
"skus": [
    { // SKU 1
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"    // duplicated value
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"    // duplicated value
        }   
      ]
    },
    { // SKU 2
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"    // duplicated value
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"    // duplicated value
        }
      ]
    }    
  ]
```

### Correct usage - Multiple attributes
Example 1: Create an SKU for red cotton sweaters, and another for red wool sweaters.
```JSON
// Product
"skus": [
    { // SKU 1 - Red cotton sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"    // unique value
        }   
      ]
    },
    { // SKU 2 - Red wool sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"
        },
        { // variation B
          "name": "Material",
          "value_name": "Wool"    // unique value
        }
      ]
    }    
  ]
```


Example 2: Create an SKU for red cotton sweaters, and another for blue cotton sweaters.
```JSON
// Product
"skus": [
    { // SKU 1 - Red cotton sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"    // unique value
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"
        }   
      ]
    },
    { // SKU 2 - Blue cotton sweater
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Blue"    // unique value
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"
        }
      ]
    }    
  ]
```


## Sales attribute count mismatch across SKUs
All SKUs must define the **same set of sales attribute ID/names**. In practical terms, this means if one SKU is defined by 2 sales attributes, such as color and material, then every other SKU for the same product must also include both attributes. Alternatively, remove the redundant attribute.
### Incorrect usage
Example: You can't have one SKU that defines both color and material, while another SKU only defines color and leaves material unspecified.
```JSON
// Product
"skus": [
    { // SKU 1
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"
        }   
      ]
    },
    { // SKU 2
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Blue"
        }
         // missing variation B      
      ]
    }    
  ]
```

### Correct usage
Example: Define both color and material for all SKUs.
```JSON
// Product
"skus": [
    { // SKU 1
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Red"
        },
        { // variation B
          "name": "Material",
          "value_name": "Cotton"
        }      
      ]
    },
    { // SKU 2
      "sales_attributes": [ 
        { // variation A
          "name": "Color",
          "value_name": "Blue"
        },
        { // added variation B
          "name": "Material",
          "value_name": "Wool"
        }    
      ]
    }    
  ]
```



