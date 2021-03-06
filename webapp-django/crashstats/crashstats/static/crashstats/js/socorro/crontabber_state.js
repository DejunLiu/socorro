/* global _, d3 */

// To be obsolete it means that your next_run was more than
// 24 hours ago.
var longAgo = new Date(new Date() - 24 * 3600 * 1000);

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

d3.json('/api/CrontabberState/').then(function(data) {
  /**
   * Reshape the data
   * Sankey wants the following:
   *   nodes: [ { name: 'something' }, { name: 'otherthing' } ]
   *   links: [ { source: 0, target: 1, value: 9001 } ]
   */
  var nodes = _.map(data.state, function(v, k) {
    v.name = k;
    // prefix with a _ because it's not native to the source data
    v._obsolete = new Date(v.next_run) < longAgo;
    return v;
  });

  // cache array positions
  _.each(nodes, function(e, i) {
    e.pos = i;
  });

  // infer skip counts by recursively walking up the tree
  // cache results in the node state
  _.each(nodes, function count_skips(node) {
    if (node.skips) {
      return node.skips;
    }
    var parents = _.map(node.depends_on, function(name) {
        return data.state[name];
      }),
      skips = _.map(parents, count_skips),
      errors = _.pluck(parents, 'error_count');
    skips = _.max([_.max(errors) + _.max(skips), 0]);
    node.skips = skips;
    return skips;
  });

  // reverse linked lists
  var links = [];
  _.each(nodes, function(element, index) {
    _.each(element.depends_on, function(d) {
      var dep = data.state[d];
      links.push({
        source: dep.pos,
        target: index,
        value: 1,
        errors: dep.error_count,
        skips: dep.skips,
      });
    });
  });

  // misconfigured, no jobs
  // potential hook for a heads up
  if (_.size(data.state) < 2) {
    return;
  }

  var table = d3.select('#crontabber-table').append('table'),
    thead = table.append('thead'),
    tbody = table.append('tbody'),
    tableFields = ['name', 'error_count', 'next_run', 'last_success', 'depends_on'];

  table.classed('data-table tablesorter', true);

  thead
    .append('tr')
    .selectAll('th')
    .data(tableFields)
    .enter()
    .append('th')
    .text(function capitalize(s) {
      return s[0].toUpperCase() + s.slice(1).replace('_', ' ');
    })
    .classed('header', true);

  tbody
    .selectAll('tr')
    .data(nodes)
    .enter()
    .append('tr')
    .filter(function(node) {
      return !node._obsolete;
    })
    .selectAll('td')
    .data(function(d) {
      // get only the tableFields
      var scrubbed = _.map(tableFields, function(field) {
        return d[field];
      });
      return scrubbed;
    })
    .enter()
    .append('td')
    .text(function(d, i) {
      var field = tableFields[i];
      var isTime = field === 'last_success' || field === 'next_run';
      if (isTime) {
        if (d) {
          return d + ' (' + moment(d).fromNow() + ')';
        } else {
          return '';
        }
      }
      if (typeof d === 'object') {
        var joined = _.reduce(
          d,
          function(m, i) {
            return m + i + ', ';
          },
          ''
        );
        return joined.substring(0, joined.length - 2);
      }
      return d;
    });

  // now do only the ongoing jobs
  table = d3.select('#ongoing-table').append('table');
  thead = table.append('thead');
  tbody = table.append('tbody');
  tableFields = ['name', 'ongoing'];
  var anyOngoing = false;

  table.classed('data-table tablesorter', true);

  thead
    .append('tr')
    .selectAll('th')
    .data(tableFields)
    .enter()
    .append('th')

    .text(function capitalize(s) {
      if (s === 'ongoing') {
        return 'Ongoing for';
      }
      return s[0].toUpperCase() + s.slice(1).replace('_', ' ');
    })
    .classed('header', true);

  tbody
    .selectAll('tr')
    .data(nodes)
    .enter()
    .append('tr')
    .filter(function(node) {
      if (node.ongoing) {
        anyOngoing = true;
      }
      return node.ongoing;
    })
    .selectAll('td')
    .data(function(d) {
      // get only the tableFields
      var scrubbed = _.map(tableFields, function(field) {
        return d[field];
      });
      return scrubbed;
    })
    .enter()
    .append('td')
    .text(function(d, i) {
      var field = tableFields[i];
      if (field === 'ongoing') {
        return moment(d).fromNow(true);
      }
      return d;
    });

  if (anyOngoing) {
    // if there are any ongoing rows, only they display the obsolete panel
    $('div.ongoing').show();
  }

  // now do only the obsolete jobs
  table = d3.select('.obsolete .body').append('table');
  thead = table.append('thead');
  tbody = table.append('tbody');
  tableFields = ['name', 'last_run'];
  var anyObsolete = false;

  table.classed('data-table tablesorter', true);
  thead
    .append('tr')
    .selectAll('th')
    .data(tableFields)
    .enter()
    .append('th')
    .text(function capitalize(s) {
      return s[0].toUpperCase() + s.slice(1).replace('_', ' ');
    })
    .classed('header', true);

  tbody
    .selectAll('tr')
    .data(nodes)
    .enter()
    .append('tr')
    .filter(function(node) {
      if (node._obsolete) {
        anyObsolete = true;
        return true;
      }
      return false;
    })
    .selectAll('td')
    .data(function(d) {
      // get only the tableFields
      var scrubbed = _.map(tableFields, function(field) {
        return d[field];
      });
      return scrubbed;
    })
    .enter()
    .append('td')
    .text(function(d, i) {
      var field = tableFields[i];
      if (field === 'last_run') {
        return moment(d).fromNow(false);
      }
      return d;
    });

  if (anyObsolete) {
    // if there are any ongoing rows, only they display the ongoing panel
    $('div.obsolete').show();
  }

  table = d3.select('#failing').append('table');
  thead = table.append('thead');
  tbody = table.append('tbody');
  tableFields = ['name', 'error_count', 'last_error'];
  table.classed('data-table tablesorter', true); // worth doing?

  thead
    .append('tr')
    .selectAll('th')
    .data(tableFields)
    .enter()
    .append('th')
    .text(function capitalize(s) {
      return s[0].toUpperCase() + s.slice(1).replace('_', ' ');
    })
    .classed('header', true);

  var anyErrors = false;
  tbody
    .selectAll('tr')
    .data(nodes)
    .enter()
    .append('tr')
    .filter(function(node) {
      if (node.error_count) {
        anyErrors = true;
      }
      return node.error_count;
    })
    .selectAll('td')
    .data(function(d) {
      return _.map(tableFields, function(field) {
        return d[field];
      });
    })
    .enter()
    .append('td')
    .html(function(d, i) {
      if (tableFields[i] === 'last_error') {
        return '<pre>' + escapeHtml(JSON.stringify(d, undefined, 4)) + '</pre>';
      }
      return escapeHtml('' + d);
    });
  if (anyErrors) {
    $('div.failing').show();
  }

  $('.tablesorter').tablesorter();
});
