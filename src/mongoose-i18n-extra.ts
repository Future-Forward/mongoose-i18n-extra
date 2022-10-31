import mongoose, { Schema } from "mongoose";
import mpath from "mpath";

interface Options {
  defaultLanguage: string;
  languages: string[];
  language: string;
}
// function to support old version of mongoose prior to 5.5.14
// because of this commit: https://github.com/Automattic/mongoose/pull/7870
function setPathValue(mongooseObj: any, path: string, value: any) {
  return mongooseObj.setValue
    ? mongooseObj.setValue(path, value)
    : mongooseObj.$__setValue(path, value);
}

function getPathValue(mongooseObj: any, path: string) {
  if (mongooseObj.getValue) {
    return mongooseObj.getValue(path);
  }
  if (mongooseObj.$__getValue) {
    return mongooseObj.$__getValue(path);
  }
  if (mongooseObj[path]) {
    return mongooseObj[path];
  }
  return mpath.get(path, mongooseObj, "_doc");
}

export default function mongooseI18nExtra(
  schema: Schema,
  options: Options
): void {
  const i18nFields: string[] = [];

  schema.eachPath(function (path: string, schemaType: any) {
    if (!schemaType.options.i18n) {
      return;
    }
    i18nFields.push(path);
    options.languages.forEach((lang) => {
      schema
        .virtual(`${path}_${lang}`)
        .get(function (this: any) {
          const key =
            lang === options.defaultLanguage ? path : `_i18n.${lang}.${path}`;
          return getPathValue(this, key);
        })
        .set(function (this: any, value: string) {
          if (lang === options.defaultLanguage) {
            // note: here path is a vitual field, so we set directly the value
            setPathValue(this, path, value);
            this.markModified(path);
          } else {
            this.set(`_i18n.${lang}.${path}`, value);
          }
        });
    });
    schemaType.options.get = function (value: any) {
      if (!this.getLanguage || this.getLanguage() === options.defaultLanguage) {
        return value;
      } else {
        let val = this.get(`_i18n.${this.getLanguage()}.${path}`);
        if (val) {
          return val;
        }
        if (schemaType.options.fallbackLang) {
          val = this.get(`_i18n.${schemaType.options.fallbackLang}.${path}`);
          if (val) {
            return val;
          }
          return value;
        }
        return this.get(`_i18n.${this.getLanguage()}.${path}`);
      }
    };
    schemaType.options.set = function (value: String) {
      if (!this.getLanguage || this.getLanguage() === options.defaultLanguage) {
        return value;
      } else {
        const currentLang = this.getLanguage();
        const _i18n = getPathValue(this, "_i18n") || {};
        _i18n[currentLang] = _i18n[currentLang] || {};
        _i18n[currentLang][path] = value;
        setPathValue(this, "_i18n", _i18n);
        this.markModified("_i18n");
        // set the value for the default language, if none exists
        const defaultValue = getPathValue(this, path);
        return this.isNew && !defaultValue ? value : defaultValue;
      }
    };
    schema.remove(path);
    schema.add({ [path]: schemaType.options });
  });

  schema
    .virtual(`_i18n`)
    .get(function (this: any) {
      const value = getPathValue(this, "_i18n") || {};
      const self = this;
      value[options.defaultLanguage] = {};
      i18nFields.forEach(function (fieldName) {
        options.languages.forEach((lang) => {
          value[lang] = value[lang] || {};
          value[lang][fieldName] = value[lang][fieldName] || null;
        });
        value[options.defaultLanguage][fieldName] = getPathValue(
          self,
          fieldName
        );
      });
      return value;
    })
    .set(function (this: any, value: any) {
      const self = this;
      if (value[options.defaultLanguage]) {
        // note: here path is a vitual field, so we set directly the value
        Object.keys(value[options.defaultLanguage]).forEach(function (key) {
          setPathValue(self, key, value[options.defaultLanguage][key]);
          self.markModified(key);
        });
        delete value[options.defaultLanguage];
      }
      setPathValue(this, "_i18n", value);
      this.markModified("_i18n");
    });

  schema.method({
    getLanguages: function (this: any) {
      return options.languages;
    },
    getLanguage: function (this: any) {
      return this.docLanguage || options.language || options.defaultLanguage;
    },
    setLanguage: function (this: any, lang: String) {
      if (lang && this.getLanguages().includes(lang)) {
        this.docLanguage = lang;
      }
    },
    unsetLanguage: function (this: any) {
      delete this.docLanguage;
    },
  });

  schema.static({
    getLanguages: function () {
      return options.languages;
    },
    getDefaultLanguage: function () {
      return options.defaultLanguage;
    },
    setLanguage: function (this: any, lang: String) {
      function updateLanguage(schema: Schema, lang: String) {
        // @ts-ignore
        options.language = lang.slice(0);

        schema.eachPath(function (path, schemaType) {
          // @ts-ignore
          if (schemaType.schema) {
            // @ts-ignore
            updateLanguage(schemaType.schema, lang);
          }
        });
      }

      if (lang && this.getLanguages().indexOf(lang) !== -1) {
        // @ts-ignore
        updateLanguage(this.schema, lang);
      }
    },
    setDefaultLanguage: function (this: any, lang: String) {
      function updateLanguage(schema: Schema, lang: String) {
        // @ts-ignore
        options.defaultLanguage = lang.slice(0);

        // default language change for sub-documents schemas
        schema.eachPath(function (path, schemaType) {
          // @ts-ignore
          if (schemaType.schema) {
            // @ts-ignore
            updateLanguage(schemaType.schema, lang);
          }
        });
      }

      if (lang && this.getLanguages().indexOf(lang) !== -1) {
        // @ts-ignore
        updateLanguage(this.schema, lang);
      }
    },
  });

  schema.on("init", function (model) {
    // no actions are required in the global method is already defined
    if (model.db.setDefaultLanguage) {
      return;
    }

    // define a global method to change the language for all models (and their schemas)
    // created for the current mongo connection
    model.db.setDefaultLanguage = function (lang: string) {
      var model, modelName;
      for (modelName in this.models) {
        if (this.models.hasOwnProperty(modelName)) {
          model = this.models[modelName];
          model.setDefaultLanguage && model.setDefaultLanguage(lang);
        }
      }
    };

    model.db.setLanguage = function (lang: string) {
      var model, modelName;
      for (modelName in this.models) {
        if (this.models.hasOwnProperty(modelName)) {
          model = this.models[modelName];
          model.setLanguage && model.setLanguage(lang);
        }
      }
    };

    // create an alias for the global change language method attached to the default connection
    // @ts-ignore
    if (!mongoose.setDefaultLanguage) {
      // @ts-ignore
      mongoose.setDefaultLanguage = mongoose.connection.setDefaultLanguage;
    }

    // create an alias for the global change language method attached to the default connection
    // @ts-ignore
    if (!mongoose.setLanguage) {
      // @ts-ignore
      mongoose.setLanguage = mongoose.connection.setLanguage;
    }
  });
}
