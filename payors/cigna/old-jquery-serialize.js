/**
 * This is jQuery 1.11.2 (probably 1.12 stable) version of jQuery.param() which
 * is used to serialize data to be sent to cigna servers as POST bodies. Their
 * code sets the `traditional` option to `true` all the time, so i've removed
 * the more complex, newer code paths.
 */

const r20 = /%20/g;

function each(a, b, d) {
  let e,
    f = 0,
    g = a.length,
    h = c(a);
  if (d) {
    if (h) for (; f < g && ((e = b.apply(a[f], d)), e !== !1); f++);
    else for (f in a) if (((e = b.apply(a[f], d)), e === !1)) break;
  } else if (h) for (; f < g && ((e = b.call(a[f], f, a[f])), e !== !1); f++);
  else for (f in a) if (((e = b.call(a[f], f, a[f])), e === !1)) break;
  return a;
}

function buildParams(prefix, obj, add) {
  if (Array.isArray(obj)) {
    // Serialize array item.
    each(obj, function(i, v) {
      add(prefix, v);
    });
  } else {
    // Serialize scalar item.
    add(prefix, obj);
  }
}

// Serialize an array of form elements or a set of
// key/values into a query string
export function param(a) {
  let s = [],
    add = function(key, value) {
      // If value is a function, invoke it and return its value
      value = value == null ? "" : value;
      s[s.length] = encodeURIComponent(key) + "=" + encodeURIComponent(value);
    };

  // If an array was passed in, assume that it is an array of form elements.
  if (Array.isArray(a)) {
    // Serialize the form elements
    each(a, function() {
      add(this.name, this.value);
    });
  } else {
    // If traditional, encode the "old" way (the way 1.3.2 or older
    // did it), otherwise encode params recursively.
    for (let prefix in a) {
      buildParams(prefix, a[prefix], add);
    }
  }

  // Return the resulting serialization
  return s.join("&").replace(r20, "+");
}
