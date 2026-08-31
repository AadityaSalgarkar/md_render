//! Talking to an already-running md-render server.
//!
//! Only two tiny localhost requests are needed, so this speaks HTTP/1.1 over a
//! plain socket rather than pulling in a full HTTP client.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, PartialEq, Eq)]
pub enum Probe {
  /// Nothing is listening; we should start the server ourselves.
  Free,
  /// An md-render server is already serving this port.
  MdRender,
  /// Something else holds the port.
  Occupied,
}

/// Split a raw HTTP response into (status code, body).
fn parse_response(raw: &str) -> Option<(u16, String)> {
  let mut parts = raw.splitn(2, "\r\n\r\n");
  let head = parts.next()?;
  let body = parts.next().unwrap_or("").to_string();
  let status = head
    .lines()
    .next()?
    .split_whitespace()
    .nth(1)?
    .parse::<u16>()
    .ok()?;
  Some((status, body))
}

fn request(host: &str, port: u16, raw: &str) -> Result<(u16, String), String> {
  let address = (host, port)
    .to_socket_addrs()
    .map_err(|err| format!("could not resolve {}:{}: {}", host, port, err))?
    .next()
    .ok_or_else(|| format!("could not resolve {}:{}", host, port))?;

  let mut stream = TcpStream::connect_timeout(&address, TIMEOUT)
    .map_err(|err| format!("could not connect to {}:{}: {}", host, port, err))?;
  stream.set_read_timeout(Some(TIMEOUT)).ok();
  stream.set_write_timeout(Some(TIMEOUT)).ok();

  stream
    .write_all(raw.as_bytes())
    .map_err(|err| format!("could not send request: {}", err))?;

  let mut response = Vec::new();
  stream
    .read_to_end(&mut response)
    .map_err(|err| format!("could not read response: {}", err))?;

  let text = String::from_utf8_lossy(&response).to_string();
  parse_response(&text).ok_or_else(|| "malformed HTTP response".to_string())
}

/// Is an md-render server already on this port?
pub fn probe(host: &str, port: u16) -> Probe {
  let raw = format!(
    "GET /api/health HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n",
    host = host,
    port = port
  );

  match request(host, port, &raw) {
    Err(_) => Probe::Free,
    Ok((status, body)) => {
      if status == 200 && body.contains("\"md-render\"") {
        Probe::MdRender
      } else {
        Probe::Occupied
      }
    }
  }
}

/// Hand new documents to a running server. Returns the labels it added and
/// the workspace names they landed in, so the caller can print the URLs.
pub fn add_documents(
  host: &str,
  port: u16,
  token: &str,
  paths: &[String],
) -> Result<(Vec<String>, Vec<String>), String> {
  let body = serde_json::json!({ "paths": paths }).to_string();
  let raw = format!(
    "POST /api/documents HTTP/1.1\r\n\
     Host: {host}:{port}\r\n\
     Authorization: Bearer {token}\r\n\
     Content-Type: application/json\r\n\
     Content-Length: {length}\r\n\
     Connection: close\r\n\r\n\
     {body}",
    host = host,
    port = port,
    token = token,
    length = body.len(),
    body = body
  );

  let (status, response) = request(host, port, &raw)?;
  if status == 401 {
    return Err(
      "the running server rejected our token; it may have been started by another user".to_string(),
    );
  }
  if status != 200 {
    return Err(format!("server refused the documents: {}", response.trim()));
  }

  let parsed: serde_json::Value =
    serde_json::from_str(&response).map_err(|err| format!("unexpected response: {}", err))?;

  let strings = |key: &str| -> Vec<String> {
    parsed
      .get(key)
      .and_then(|value| value.as_array())
      .map(|items| {
        items
          .iter()
          .filter_map(|item| item.as_str().map(|s| s.to_string()))
          .collect()
      })
      .unwrap_or_default()
  };

  Ok((strings("added"), strings("workspaces")))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_a_status_line_and_body() {
    let raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"app\":\"md-render\"}";
    let (status, body) = parse_response(raw).unwrap();
    assert_eq!(status, 200);
    assert_eq!(body, "{\"app\":\"md-render\"}");
  }

  #[test]
  fn parses_a_response_with_no_body() {
    let (status, body) = parse_response("HTTP/1.1 401 Unauthorized\r\n\r\n").unwrap();
    assert_eq!(status, 401);
    assert_eq!(body, "");
  }

  #[test]
  fn rejects_garbage() {
    assert!(parse_response("not http at all").is_none());
  }

  #[test]
  fn probing_a_dead_port_reports_free() {
    // Port 1 on loopback: nothing should be listening as an unprivileged user.
    assert_eq!(probe("127.0.0.1", 1), Probe::Free);
  }
}
