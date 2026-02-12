require 'net/http'
require 'uri'
require 'json'

class WebScraper
  def initialize(base_url)
    @base_url = URI.parse(base_url)
  end

  def fetch(path)
    uri = URI.join(@base_url, path)
    response = Net::HTTP.get_response(uri)
    raise "HTTP #{response.code}" unless response.is_a?(Net::HTTPSuccess)
    response.body
  end

  def fetch_json(path)
    JSON.parse(fetch(path))
  end

  def extract_links(html)
    html.scan(/href=["']([^"']+)["']/).flatten.uniq
  end
end

scraper = WebScraper.new("https://api.example.com")
data = scraper.fetch_json("/posts")
puts "Found #{data.length} posts"
