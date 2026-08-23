FROM docker.elastic.co/elasticsearch/elasticsearch:8.19.0

# The IK plugin version must match the Elasticsearch version exactly.
RUN bin/elasticsearch-plugin install --batch \
    https://get.infini.cloud/elasticsearch/analysis-ik/8.19.0
