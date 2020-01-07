/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import _ from 'lodash';
import {
  Control,
  noValuesDisableMsg,
  noIndexPatternMsg,
} from './control';
import { PhraseFilterManager } from './filter_manager/phrase_filter_manager';
import { i18n } from '@kbn/i18n';

function getEscapedQuery(query = '') {
  // https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-regexp-query.html#_standard_operators
  return query.replace(/[.?+*|{}[\]()"\\#@&<>~]/g, (match) => `\\${match}`);
}

const termsAgg = ({ field, size, direction }) => {
  const terms = {
    order: {
      _count: direction
    }
  };

  if (size) {
    terms.size = size < 1 ? 1 : size;
  }

  if (field.scripted) {
    terms.script = {
      source: field.script,
      lang: field.lang
    };
    terms.valueType = field.type === 'number' ? 'float' : field.type;
  } else {
    terms.field = field.name;
  }

  return {
    'termsAgg': {
      'terms': terms
    }
  };
};

class ListControl extends Control {

  constructor(controlParams, filterManager, kbnApi, useTimeFilter, selectOptions) {
    super(controlParams, filterManager, kbnApi, useTimeFilter);

    this.selectOptions = selectOptions;
  }


  fetch = async (query) => {
    this.enable = true;
    this.disabledReason = '';
  }


  getMultiSelectDelimiter() {
    return this.filterManager.delimiter;
  }

  hasValue() {
    return typeof this.value !== 'undefined' && this.value.length > 0;
  }
}

export async function listControlFactory(controlParams, kbnApi, useTimeFilter) {
  const indexPattern = await kbnApi.indexPatterns.get(controlParams.indexPattern);

  try {
    // dynamic options are only allowed on String fields but the setting defaults to true so it could
    // be enabled for non-string fields (since UI input is hidden for non-string fields).
    // If field is not string, then disable dynamic options.
    const field = indexPattern.fields.find((field) => {
      return field.name === controlParams.fieldName;
    });
    if (field && field.type !== 'string') {
      controlParams.options.dynamicOptions = false;
    }
  } catch (err) {
    // ignore not found error and return control so it can be displayed in disabled state.
  }

  const filterManager = new PhraseFilterManager(controlParams.id, controlParams.fieldName, indexPattern, kbnApi.queryFilter)
  const fieldName = filterManager.fieldName;
  const initialSearchSourceState = {
    timeout: '1s',
    terminate_after: 100000
  };

  const aggs = termsAgg({
    field: indexPattern.fields.byName[fieldName],
    size: _.get(controlParams, 'options.size', 5),
    direction: 'desc'
  });

    const filters = await kbnApi.queryFilter.getFilters();
    const searchSource = new kbnApi.SearchSource(initialSearchSourceState);
    // Do not not inherit from rootSearchSource to avoid picking up time and globals
    searchSource.setParent(false);
    searchSource.setField('size', 0);
    searchSource.setField('index', indexPattern);
    searchSource.setField('filter', filters);
    searchSource.setField('aggs', aggs);


    const resp = await searchSource.fetch();


    const selectOptions = _.get(resp, 'aggregations.termsAgg.buckets', []).map((bucket) => {
      return bucket.key;
    });

  const listControl = new ListControl(
    controlParams,
    filterManager,
    // new PhraseFilterManager(controlParams.id, controlParams.fieldName, indexPattern, kbnApi.queryFilter),
    kbnApi,
    useTimeFilter,
    selectOptions
  );

  if(selectOptions.length === 0) {
    listControl.disable(noValuesDisableMsg(controlParams.fieldName, indexPattern.title));
    // return;
  }

  return listControl;
}
